// server/services/serviceQueue.ts
// 云产品级并发队列框架（本地 p-queue 排队/优先级 + Redis 分布式信号量跨实例全局闸门）。
//
// 三层流量治理职责链（各管各的，勿混淆）：
//   1. rateLimiter    —— 防滥用（按 IP/用户滑窗计数，拒绝型，入口层）
//   2. quotaChecker   —— 防超支（按用户按天额度，拒绝型，业务层）
//   3. serviceQueue   —— 防打爆下游（按云产品并发闸门，等待型，资源层）← 本模块
//
// 设计约定：
// - 队列粒度 = 云产品（并发配额是云产品的属性，不是接口的属性）。
//   注册表：tts / nls / deepseek（云产品） + upload（材料上传流水线业务任务）。
// - OSS 与 DB 显式不接：OSS 无并发瓶颈；DB 连接池（connectionLimit + waitForConnections）本身就是队列。
// - 并发数来自 sys_config（queue_{name}_concurrency，经 configStore 双 Adapter 批量读取，
//   管理端 PUT 后 DEL 即时失效、失败 ≤10s TTL 自愈）；0 或缺失 = 不限流（直通，接入零风险）。
// - 队列永远不是任务的持久化真相源——进程重启队列即空，上传任务真相在 material_upload_record，
//   由 server/plugins/02.queueRecovery.ts 启动扫描兜底。
// - 埋点口径：cloud_service_call_log.duration_ms 只计执行不计排队（各服务函数的计时起点
//   必须位于队列 acquire 之后，即包裹在 withQueue 的 task 内部）。
// - 水平扩展（P4 已外置并发闸门）：本地 p-queue 按配置限流 + 排队/优先级；其上叠加 Redis
//   分布式信号量（server/utils/redis/semaphore.ts，key 经 redisKey('sem', name)）作为跨实例
//   全局并发闸门，多实例总并发受配置约束；Redis 不可用/失败自动 bypass 退回进程内闸门
//   （fail-open，功能不中断）。
import PQueue from 'p-queue'
import { fileLog } from '#server/utils/fileLogger'
import { acquireSlot, releaseSlot, renewSlot } from '#server/utils/redis/semaphore'

/** 已注册的队列名（新增服务 = 此处加名字 + 迁移插 sys_config key + config 页加输入框） */
export type ServiceQueueName = 'tts' | 'nls' | 'deepseek' | 'upload'

const QUEUE_NAMES: ServiceQueueName[] = ['tts', 'nls', 'deepseek', 'upload']

/**
 * 测试短路：Vitest 下 withQueue 直通执行任务，不加载 p-queue 调度与 configStore 配置链，
 * 保护真实加载 tts.ts/speechToText.ts 等模块链的既有测试（仿 fileLogger 的 IS_TEST 先例）。
 * serviceQueue 自身的单测通过 __forceEnableForTest() 显式开启真实路径。
 */
const IS_TEST = process.env.VITEST === 'true'
let forceEnabledInTest = false

/** 队列实例注册表（懒创建，模块作用域零副作用：无定时器、不碰 useRuntimeConfig） */
const queues = new Map<ServiceQueueName, PQueue>()

/** 等待告警：任务在队列中等待超过该时长则记文件日志（节流：每队列每分钟至多一条） */
const WAIT_WARN_MS = 10_000
const warnThrottle = new Map<ServiceQueueName, number>()

/** 全局信号量租约：执行中任务占用的 Redis List 元素 TTL（防崩溃卡死，超时自动回收名额） */
const SEMAPHORE_LEASE_MS = 5 * 60 * 1000
/** 全局信号量续租间隔：执行中任务周期性续租（远小于租约，防长任务租约过期被误回收、突破并发闸门） */
const SEMAPHORE_RENEW_MS = 60 * 1000
/** 全局闸门无名额时的轮询重试间隔（配合本地 p-queue 的排队语义） */
const SEMAPHORE_RETRY_MS = 200

function getQueue(name: ServiceQueueName): PQueue {
  let q = queues.get(name)
  if (!q) {
    q = new PQueue({ concurrency: Infinity })
    queues.set(name, q)
  }
  return q
}

/** 单飞（single-flight）：并发入队时共享同一次配置读取，避免重复调用 configStore 与并发动态 import 竞态 */
let refreshInFlight: Promise<Map<ServiceQueueName, number>> | null = null

/**
 * 读取并应用并发配置（经 configStore 双 Adapter 批量读取，缓存语义由 configStore 承载：
 * Redis 可用 10s 抖动 TTL / 不可用内存 5min TTL；管理端 PUT 后 DEL 即时失效）。
 * configStore 用动态 import：测试直通路径与未触发刷新时完全不加载 db/redis 模块链。
 * 读取失败时本次按不限流处理（0=直通），不阻塞业务；队列实例保持既有并发不回退。
 */
async function refreshConcurrency(): Promise<Map<ServiceQueueName, number>> {
  if (refreshInFlight) {
    return refreshInFlight
  }
  refreshInFlight = (async () => {
    try {
      const { getSysConfigKeys } = await import('#server/utils/configStore')
      const map = await getSysConfigKeys(QUEUE_NAMES.map((n) => `queue_${n}_concurrency`))
      const values = new Map<ServiceQueueName, number>()
      for (const name of QUEUE_NAMES) {
        const raw = parseInt(map.get(`queue_${name}_concurrency`) ?? '0', 10)
        values.set(name, isNaN(raw) || raw < 0 ? 0 : raw)
      }
      // 热更新已注册队列（p-queue 支持运行时改 concurrency，调低不会打断执行中任务）
      for (const name of QUEUE_NAMES) {
        const n = values.get(name) ?? 0
        getQueue(name).concurrency = n > 0 ? n : Infinity
      }
      return values
    } catch {
      // 读取失败：本次按不限流处理（0=直通），不阻塞业务；队列实例保持既有并发不回退
      const fallback = new Map<ServiceQueueName, number>()
      for (const name of QUEUE_NAMES) fallback.set(name, 0)
      return fallback
    } finally {
      refreshInFlight = null
    }
  })()
  return refreshInFlight
}

/**
 * 确保并发配置已加载并热更到队列实例（供 GET /api/admin/monitor 在读水位前调用）。
 * 背景：配置为惰性加载——只在首次 withQueue 时读取；服务刚重启且无云调用时队列实例
 * 保持初始 Infinity，getQueueStats 会误报「不限流」。读取走 configStore 缓存，监控轮询不放大查询。
 */
export async function syncServiceQueueConcurrency(): Promise<void> {
  if (IS_TEST && !forceEnabledInTest) return
  await refreshConcurrency()
}

export interface WithQueueOptions {
  /** 优先级：数值越大越先执行（p-queue 语义）。约定：用户交互任务 1，后台/管理员批量 0 */
  priority?: number
  /** 排队取消信号：触发时若任务尚未开始执行则 reject（p-queue 惰性取消：项仍占 size 计数、闭包保留至出队） */
  signal?: AbortSignal
}

/**
 * 以指定云产品队列的并发闸门执行任务。
 * 并发配置为 0/缺失时直通执行（不限流）；Vitest 环境默认直通（见 IS_TEST）。
 * 注意：task 内部才是「执行阶段」——各服务的埋点计时起点必须放在 task 内。
 */
export async function withQueue<T>(
  name: ServiceQueueName,
  task: () => Promise<T>,
  options: WithQueueOptions = {},
): Promise<T> {
  if (IS_TEST && !forceEnabledInTest) {
    return task()
  }

  const values = await refreshConcurrency()
  if ((values.get(name) ?? 0) <= 0) {
    return task()
  }

  const queue = getQueue(name)
  const enqueuedAt = Date.now()
  return queue.add(
    async () => {
      const waited = Date.now() - enqueuedAt
      if (waited > WAIT_WARN_MS) {
        const last = warnThrottle.get(name) ?? 0
        if (Date.now() - last > 60_000) {
          warnThrottle.set(name, Date.now())
          fileLog('api', 'warn', `[serviceQueue] ${name} 队列等待超阈值`, {
            waitedMs: waited,
            size: queue.size,
            pending: queue.pending,
            concurrency: queue.concurrency,
          })
        }
      }
      // 本地 p-queue 已按配置限流，此处再叠加 Redis 分布式信号量作为「跨实例全局闸门」：
      // 多实例部署时各实例共享同一把 Redis 信号量，保证跨实例总并发不超过配置；
      // 无名额则轮询等待（配合本地排队）；Redis 不可用/失败时 acquireSlot 返回
      // SEMAPHORE_BYPASS_TOKEN 直接放行（bypass），行为退出现状「进程内闸门」，功能不中断。
      const max = values.get(name) ?? 0 // 已加载；此处 values.get(name) > 0 有保证（见上方 <=0 直通）
      let token = await acquireSlot(name, max, SEMAPHORE_LEASE_MS)
      while (token === null) {
        await new Promise((r) => setTimeout(r, SEMAPHORE_RETRY_MS))
        token = await acquireSlot(name, max, SEMAPHORE_LEASE_MS)
      }
      // 长任务续租：周期刷新租约，防执行超出租约过期被误回收（bypass token 上 renewSlot 为 no-op）
      const renewTimer = setInterval(() => {
        void renewSlot(name, token, SEMAPHORE_LEASE_MS).catch(() => {})
      }, SEMAPHORE_RENEW_MS)
      try {
        return await task()
      } finally {
        clearInterval(renewTimer)
        await releaseSlot(name, token)
      }
    },
    { priority: options.priority ?? 0, signal: options.signal },
  ) as Promise<T>
}

/** 各队列实时水位快照（供 GET /api/admin/queues 观测） */
export function getQueueStats(): Array<{
  name: ServiceQueueName
  concurrency: number
  size: number
  pending: number
}> {
  return QUEUE_NAMES.map((name) => {
    const q = getQueue(name)
    return {
      name,
      concurrency: q.concurrency === Infinity ? 0 : q.concurrency,
      size: q.size,
      pending: q.pending,
    }
  })
}

/** 仅供 serviceQueue 单测显式开启真实队列路径（生产代码禁止调用） */
export function __forceEnableForTest(enabled: boolean): void {
  forceEnabledInTest = enabled
}
