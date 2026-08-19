// server/utils/redis/clusterLock.ts
// 分布式锁基建（P4 缺口 #2）：后台插件定时器（guestCleanup / logArchiveScheduler /
// cloudHealthMonitor / orphanAudioCleanup / apiCallLogger 文件日志清理）在单实例部署下每次仅
// 一个实例执行；水平扩展后若多实例同时运行，同一 tick 每实例都会跑一遍 → 重复执行。
// 用 Redis 的 SET NX PX 原子抢占 + 持有者令牌 + compare-and-delete 保证每个 tick 只有一个实例执行任务。
//
// 语义：
// - SET key instanceId NX PX ttlMs 原子抢占：返回 'OK' → 本实例获得锁并执行任务；
//   null → 锁已被其他实例持有，跳过本轮（不执行）。
// - 持有者令牌（instanceId = 进程级随机 8 位）：task 完成后 GET 校验锁仍属于本实例才 DEL，
//   防止锁在 task 执行期间过期被他人持有后，本实例误删他人锁（compare-and-delete）。
// - Redis 不可用（getRedis() 返回 null）→ 直跑任务（单实例行为，功能不中断）。
// - 加锁命令异常（Redis 抖动）→ fail-open 直跑任务 + warn 留痕（与「降级直跑」一致）。
// - 释放（GET/DEL）命令异常 → 仅 warn，锁随 TTL 自然过期，不影响任务结果。
// - 任务须幂等：任务执行超过 TTL 后锁过期，其他实例可能并发进入（罕见重复可接受，由业务幂等兜底）。
import { randomUUID } from 'node:crypto'
import { redisKey } from '#server/utils/redis/keys'
import { logger } from '#shared/utils/logger'

/** 实例唯一标识（进程级）：锁持有者令牌，compare-and-delete 校验用 */
const instanceId = randomUUID().slice(0, 8)

/**
 * 带分布式锁执行任务：每个 tick 仅一个实例执行 task，其余实例跳过。
 * 返回 true 表示本轮执行了任务（含 Redis 不可用 / 加锁异常 fail-open 直跑）；false 表示锁被占用跳过。
 */
export async function withClusterLock(
  name: string,
  task: () => Promise<void>,
  opts?: { ttlMs?: number },
): Promise<boolean> {
  const ttlMs = opts?.ttlMs ?? 10 * 60 * 1000

  // DYNAMIC import redisConn：规避循环依赖（redisConn→alertEventLog→queueStore），
  // 且避免测试环境加载真实 redis 包（queueStore 同款先例）
  const { getRedis } = await import('#server/utils/redisConn')
  const client = getRedis()
  if (!client) {
    // Redis 未配置 / 断连 → 直跑（单实例行为，不建锁）
    await task()
    return true
  }

  const key = redisKey('lock', name)
  let acquired: string | null
  try {
    // SET NX PX 原子抢占：返回 'OK' = 本实例抢到锁；null = 他人持有
    acquired = await client.set(key, instanceId, { NX: true, PX: ttlMs })
  } catch (err) {
    // 加锁命令异常 fail-open：直跑任务 + warn 留痕（与降级直跑语义一致）
    logger.warn(
      `[cluster lock:${name}] 加锁命令失败，直跑任务：${
        err instanceof Error ? err.message : String(err)
      }`,
    )
    await task()
    return true
  }

  if (acquired !== 'OK') {
    // 锁被占用 → 跳过本轮，不执行
    return false
  }

  try {
    await task()
    return true
  } finally {
    // compare-and-delete：仅当锁仍属于本实例才删，防止锁过期被他人持有后误删他人锁
    try {
      if ((await client.get(key)) === instanceId) {
        await client.del(key)
      }
    } catch (err) {
      // 释放失败不阻塞任务结果：锁将随 TTL 自然过期
      logger.warn(
        `[cluster lock:${name}] 释放锁失败（锁将随 TTL 自然过期）：${
          err instanceof Error ? err.message : String(err)
        }`,
      )
    }
  }
}
