import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// keys.ts（P1，D-P1-3）：redisKey 构造器 + cfg 域白名单 + TTL.CONFIG_CACHE 抖动。
// 纯函数模块无模块级状态，env 段在每次调用时读 process.env.NODE_ENV（vi.stubEnv 即时生效），
// 无需 resetModules + 动态 import。

beforeEach(() => {
  // vitest 默认 NODE_ENV=test（非 development → prod 段），显式固定便于断言稳定
  vi.stubEnv('NODE_ENV', 'test')
})

afterEach(() => {
  vi.unstubAllEnvs()
})

// ============ redisKey 构造 ============

describe('redisKey - key 构造', () => {
  it("NODE_ENV=development → 'dev' 段：ep:dev:cfg:{key}", async () => {
    vi.stubEnv('NODE_ENV', 'development')
    const { redisKey } = await import('../redis/keys')
    expect(redisKey('cfg', 'rate_limit_enabled')).toBe('ep:dev:cfg:rate_limit_enabled')
  })

  it("NODE_ENV=production → 'prod' 段", async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const { redisKey } = await import('../redis/keys')
    expect(redisKey('cfg', 'daily_eval_limit')).toBe('ep:prod:cfg:daily_eval_limit')
  })

  it("其余 NODE_ENV（test 等）一律 → 'prod' 段", async () => {
    vi.stubEnv('NODE_ENV', 'test')
    const { redisKey } = await import('../redis/keys')
    expect(redisKey('cfg', 'rate_limit_upload_max')).toBe('ep:prod:cfg:rate_limit_upload_max')
  })

  it('非法 domain 在类型层被拒绝（白名单外编译报错，运行时为纯拼接不拦截）', async () => {
    const { redisKey } = await import('../redis/keys')
    // @ts-expect-error 'zz' 不在 domain 白名单，类型层应报错（'q' 已随 P3 queueStore 入表）
    const runtime = redisKey('zz', 'x')
    // 运行时不做白名单拦截（类型层是唯一防线），仅验证纯拼接语义
    expect(runtime).toBe('ep:prod:zz:x')
  })
})

// ============ REDIS_DOMAIN 白名单 ============

describe('REDIS_DOMAIN - 域白名单常量', () => {
  it("白名单 'cfg'（P1 configStore）+ 'rl'/'fail'（P2 rateStore）+ 'q'（P3 queueStore 埋点队列）+ 'evt'/'lock'/'sem'（P4 事件节流/分布式锁/信号量）", async () => {
    const { REDIS_DOMAIN } = await import('../redis/keys')
    expect([...REDIS_DOMAIN]).toEqual(['cfg', 'rl', 'fail', 'q', 'evt', 'lock', 'sem'])
  })

  it("P2 新增 'rl'/'fail' 域可经 redisKey 构造（rateStore 计数键，NODE_ENV=test → prod 段）", async () => {
    const { redisKey } = await import('../redis/keys')
    expect(redisKey('rl', 'ip:1.2.3.4:/api/client-error')).toBe(
      'ep:prod:rl:ip:1.2.3.4:/api/client-error',
    )
    expect(redisKey('fail', 'user:42')).toBe('ep:prod:fail:user:42')
  })

  it("P3 新增 'q' 域可经 redisKey 构造（queueStore stream 键，namespace 与真实表名对齐）", async () => {
    const { redisKey } = await import('../redis/keys')
    expect(redisKey('q', 'api_call_log')).toBe('ep:prod:q:api_call_log')
    expect(redisKey('q', 'cloud_service_call_log')).toBe('ep:prod:q:cloud_service_call_log')
    expect(redisKey('q', 'alert_event')).toBe('ep:prod:q:alert_event')
  })
})

// ============ TTL.CONFIG_CACHE 抖动 ============

describe('TTL.CONFIG_CACHE - 10s 基准 ±10% 抖动', () => {
  it('返回整数秒，落在 [9, 11]（10s ±10%），且 ≥1', async () => {
    const { TTL } = await import('../redis/keys')
    for (let i = 0; i < 200; i++) {
      const ttl = TTL.CONFIG_CACHE()
      expect(Number.isInteger(ttl)).toBe(true)
      expect(ttl).toBeGreaterThanOrEqual(9)
      expect(ttl).toBeLessThanOrEqual(11)
    }
  })

  it('多次调用有随机性（200 次采样出现多于一种取值）', async () => {
    const { TTL } = await import('../redis/keys')
    const seen = new Set<number>()
    for (let i = 0; i < 200; i++) {
      seen.add(TTL.CONFIG_CACHE())
    }
    expect(seen.size).toBeGreaterThan(1)
  })
})
