// server/utils/redis/semaphore.ts
// P4 跨实例并发闸门（D-P4-1）：serviceQueue 分布式信号量。
//
// 背景：serviceQueue 的 p-queue 并发闸门为进程内状态，多实例部署时每实例各持一把本地
// 闸门，实际并发 ≈ N × 配置。本模块在本地 p-queue 之上叠加 Redis 分布式信号量作为
// 「全局并发闸门」：本地 p-queue 仍负责排队/优先级，全局信号量保证跨实例总并发不超配置。
//
// 实现（原子性）：
// - token 存 Redis List（key 经 redisKey('sem', name)，name=队列名如 'nls'），每个执行中
//   任务占一个元素，元素值 = randomUUID token。
// - acquire/release/renew 均为 Lua 脚本（string 常量）保证原子性：
//   ACQUIRE = LLEN 已达上限返回 nil（无名额），否则 RPUSH token + PEXPIRE 租约；
//   RELEASE = LREM 移除本 token（幂等），列表空则 DEL 清键；RENEW = PEXPIRE 续租。
// - TTL 租约（leaseMs）防崩溃卡死：实例崩溃后 token 随键过期自动回收，名额不被永久占用。
// - 降级（fail-open）：Redis 不可用（未配置/断连/命令抛错）→ 返回 SEMAPHORE_BYPASS_TOKEN
//   （本地占位 token），release/renew 对其 no-op，行为退回现状「进程内闸门」，功能不中断。
// - 单测经 fake eval 模拟共享 Redis（见 server/utils/__tests__/semaphore.test.ts）。
import { randomUUID } from 'node:crypto'
import { redisKey } from '#server/utils/redis/keys'
import { logger } from '#shared/utils/logger'

/** ACQUIRE Lua：LLEN 达上限返回 nil（无名额），否则 RPUSH token + PEXPIRE 租约后返回 token（原子） */
export const ACQUIRE_LUA = `local len = redis.call('LLEN', KEYS[1]) if tonumber(len) >= tonumber(ARGV[1]) then return nil end redis.call('RPUSH', KEYS[1], ARGV[2]) redis.call('PEXPIRE', KEYS[1], ARGV[3]) return ARGV[2]`

/** RELEASE Lua：LREM 移除本 token（幂等），列表空则 DEL 清键（避免空键残留） */
export const RELEASE_LUA = `redis.call('LREM', KEYS[1], 0, ARGV[1]) if redis.call('LLEN', KEYS[1]) == 0 then redis.call('DEL', KEYS[1]) end return 1`

/** RENEW Lua：PEXPIRE 续租（长任务执行期间防租约过期被误回收） */
export const RENEW_LUA = `return redis.call('PEXPIRE', KEYS[1], ARGV[1])`

/**
 * 降级占位 token：Redis 不可用/命令失败时 acquireSlot 返回它，
 * releaseSlot/renewSlot 对其 no-op——本地 p-queue 闸门照常工作，行为退出现状。
 */
export const SEMAPHORE_BYPASS_TOKEN = '__local__'

/** 错误消息脱敏：仅取 message（不落堆栈，与 redisConn/rateStore 口径一致） */
function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * 获取全局并发名额：成功返回 token（释放/续租凭据）；无名额返回 null；Redis 不可用或
 * 命令抛错返回 SEMAPHORE_BYPASS_TOKEN（fail-open 降级，不拖慢业务）。
 * redisConn 动态 import：消解静态环（semaphore→redisConn→alertEventLog→queueStore→…），
 * 且测试/未接入 Redis 时不加载连接层模块链。
 */
export async function acquireSlot(
  name: string,
  max: number,
  leaseMs: number,
): Promise<string | null> {
  const { getRedis } = await import('#server/utils/redisConn')
  const client = getRedis()
  if (!client) return SEMAPHORE_BYPASS_TOKEN
  const token = randomUUID()
  try {
    const res = await client.eval(ACQUIRE_LUA, {
      keys: [redisKey('sem', name)],
      arguments: [String(max), token, String(leaseMs)],
    })
    return typeof res === 'string' && res.length > 0 ? res : null
  } catch (err) {
    logger.warn(
      `[semaphore] acquire ${name} 命令失败，降级本地闸门（fail-open）：${errorMessage(err)}`,
    )
    return SEMAPHORE_BYPASS_TOKEN
  }
}

/** 释放全局并发名额（幂等；bypass token 与 Redis 不可用均为 no-op，永不抛错） */
export async function releaseSlot(name: string, token: string): Promise<void> {
  if (token === SEMAPHORE_BYPASS_TOKEN) return
  const { getRedis } = await import('#server/utils/redisConn')
  const client = getRedis()
  if (!client) return
  try {
    await client.eval(RELEASE_LUA, {
      keys: [redisKey('sem', name)],
      arguments: [token],
    })
  } catch (err) {
    logger.warn(
      `[semaphore] release ${name} 失败（token 随租约过期自动回收，不影响正确性）：${errorMessage(err)}`,
    )
  }
}

/** 续租：刷新全局名额的 TTL（长任务执行期间定期调用防租约过期被误回收；失败仅 warn） */
export async function renewSlot(name: string, token: string, leaseMs: number): Promise<void> {
  if (token === SEMAPHORE_BYPASS_TOKEN) return
  const { getRedis } = await import('#server/utils/redisConn')
  const client = getRedis()
  if (!client) return
  try {
    await client.eval(RENEW_LUA, {
      keys: [redisKey('sem', name)],
      arguments: [String(leaseMs)],
    })
  } catch (err) {
    logger.warn(`[semaphore] renew ${name} 失败（续租失败可能提前释放名额）：${errorMessage(err)}`)
  }
}
