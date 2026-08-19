// server/utils/redis/keys.ts
// Redis key 构造器与 TTL 常量（P1，D-P1-3）：所有写 Redis 的调用点必须经 redisKey() 生成 key，
// 禁止调用点硬编码拼接（key 规范 ep:{env}:{domain}:{type/id}，见设计方案 §3.2）。
//
// - {env} 段由 NODE_ENV 派生：development → dev，其余（production/test 等）一律 prod；
//   未来多套生产环境再显式覆盖。派生在每次调用时读取（非 import 期固化），便于测试与热切换。
// - domain 白名单本期仅 'cfg'（configStore）；'rl'/'fail'/'q' 随 P2 rateStore / P3 queueStore
//   各自模块落地时再入表，避免本期提前铺设无人消费的域。

/** domain 白名单（as const 保类型字面量，新增域只改此处） */
export const REDIS_DOMAIN = ['cfg'] as const

/** 合法 domain 类型：白名单外的取值在编译期被拒绝 */
export type RedisDomain = (typeof REDIS_DOMAIN)[number]

/**
 * TTL 抖动构造器：base 秒 ± 抖动比例，四舍五入取整秒，下限 1s（保证 >0，volatile-lru 淘汰前提）。
 */
function jitterTtlSeconds(base: number, ratio: number): number {
  const span = base * ratio
  return Math.max(1, Math.round(base + (Math.random() * 2 - 1) * span))
}

/** 各域 TTL（秒）：值带 ±10% 随机抖动，防止集中过期造成回源风暴 */
export const TTL = {
  /** sys_config 缓存：基准 10s（快速感知 admin 改配置）±10% 抖动 */
  CONFIG_CACHE: () => jitterTtlSeconds(10, 0.1),
} as const

/**
 * key 构造器：ep:{env}:{domain}:{id}。
 * env 段调用时派生；domain 白名单外的取值由类型层拒绝（运行时为纯拼接，不重复拦截）。
 */
export function redisKey(domain: RedisDomain, id: string): string {
  const env = process.env.NODE_ENV === 'development' ? 'dev' : 'prod'
  return `ep:${env}:${domain}:${id}`
}
