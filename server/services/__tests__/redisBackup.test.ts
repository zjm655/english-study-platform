import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { H3Event } from 'h3'

// 运维备份服务（P4 后续 spec 任务 3）：BGSAVE 触发 + persistence / RDB 文件状态解析。
// mock 策略对齐 semaphore.test.ts 先例：vi.hoisted + vi.mock redisConn（getRedis 返回 fake
// client 或 null）+ vi.mock logger + vi.resetModules + 动态 import 重置模块态；
// node:fs/promises 的 stat mock 化以断言 RDB 文件大小读取与失败回落。
// 端点门禁测试：vi.doMock '#server/services/permission' + '#server/utils/redisBackup'
// 验证缺 ops_backup → 403 且不触发 BGSAVE。
// 覆盖：① 成功路径（BGSAVE + persistence 解析 + RDB 大小）② bgsave 进行中
// ③ stat 失败 rdbSizeBytes 回落 null ④ info 失败状态回落默认值
// ⑤ getRedis()=null 抛业务错误 ⑥ 端点 403 门禁。

interface FakeClient {
  bgSave: ReturnType<typeof vi.fn>
  info: ReturnType<typeof vi.fn>
  configGet: ReturnType<typeof vi.fn>
}

const { mockGetRedis, mockLogger, mockStat, mockEnsurePermission, mockTriggerRedisBackup } =
  vi.hoisted(() => {
    // 端点动态导入依赖 Nitro 自动注入的 defineEventHandler（node 测试环境未注入，这里补齐）
    ;(globalThis as unknown as { defineEventHandler: unknown }).defineEventHandler = (
      handler: unknown,
    ) => handler
    return {
      mockGetRedis: vi.fn(),
      mockLogger: {
        error: vi.fn(),
        warn: vi.fn(),
        info: vi.fn(),
        log: vi.fn(),
        debug: vi.fn(),
      },
      mockStat: vi.fn(),
      mockEnsurePermission: vi.fn(),
      mockTriggerRedisBackup: vi.fn(),
    }
  })

vi.mock('#server/utils/redisConn', () => ({ getRedis: mockGetRedis }))
vi.mock('#shared/utils/logger', () => ({ logger: mockLogger }))
vi.mock('node:fs/promises', () => ({ stat: mockStat }))

beforeEach(() => {
  vi.clearAllMocks()
  vi.resetModules()
  // NODE_ENV=test → env 段固定 prod（对齐先例；本模块无 key 断言）
  vi.stubEnv('NODE_ENV', 'test')
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.doUnmock('#server/services/permission')
  vi.doUnmock('#server/utils/redisBackup')
})

// 每次拿到干净的模块实例（隔离 mock 状态）
async function loadService() {
  return await import('../redisBackup')
}

/** fake Redis client：消费 bgSave / info / configGet 命令 */
function createFakeClient(): FakeClient {
  return {
    bgSave: vi.fn().mockResolvedValue('OK'),
    info: vi.fn(),
    configGet: vi.fn(),
  }
}

// ============ ① 成功路径 ============

describe('triggerRedisBackup - 成功路径', () => {
  it('触发 BGSAVE，解析 persistence 与 RDB 文件大小', async () => {
    const client = createFakeClient()
    client.info.mockResolvedValue(
      '# Persistence\nloading:0\nrdb_last_bgsave_time_sec:42\nrdb_bgsave_in_progress:0\n',
    )
    client.configGet.mockImplementation(async (key: string) =>
      key === 'dir' ? { dir: '/data' } : { dbfilename: 'dump.rdb' },
    )
    mockStat.mockResolvedValue({ size: 2048 })
    mockGetRedis.mockReturnValue(client)
    const { triggerRedisBackup } = await loadService()

    const res = await triggerRedisBackup()

    expect(client.bgSave).toHaveBeenCalledTimes(1)
    expect(client.info).toHaveBeenCalledWith('persistence')
    expect(res).toEqual({
      triggered: true,
      lastSaveAgoSec: 42,
      inProgress: false,
      rdbSizeBytes: 2048,
    })
  })

  it('bgsave 进行中（rdb_bgsave_in_progress:1）→ inProgress=true', async () => {
    const client = createFakeClient()
    client.info.mockResolvedValue('rdb_last_bgsave_time_sec:42\nrdb_bgsave_in_progress:1\n')
    client.configGet.mockImplementation(async (key: string) =>
      key === 'dir' ? { dir: '/data' } : { dbfilename: 'dump.rdb' },
    )
    mockStat.mockResolvedValue({ size: 1024 })
    mockGetRedis.mockReturnValue(client)
    const { triggerRedisBackup } = await loadService()

    const res = await triggerRedisBackup()

    expect(res.inProgress).toBe(true)
    expect(res.lastSaveAgoSec).toBe(42)
    expect(res.rdbSizeBytes).toBe(1024)
  })
})

// ============ ③④ 状态读取失败回落 ============

describe('triggerRedisBackup - 状态读取失败回落', () => {
  it('RDB 文件不可读（stat 抛错）→ rdbSizeBytes=null，仍返回 triggered=true', async () => {
    const client = createFakeClient()
    client.info.mockResolvedValue('rdb_last_bgsave_time_sec:42\nrdb_bgsave_in_progress:0\n')
    client.configGet.mockImplementation(async (key: string) =>
      key === 'dir' ? { dir: '/data' } : { dbfilename: 'dump.rdb' },
    )
    mockStat.mockRejectedValue(new Error('ENOENT: no such file'))
    mockGetRedis.mockReturnValue(client)
    const { triggerRedisBackup } = await loadService()

    const res = await triggerRedisBackup()

    expect(res.triggered).toBe(true)
    expect(res.rdbSizeBytes).toBeNull()
    expect(client.bgSave).toHaveBeenCalledTimes(1)
  })

  it('info 读取失败 → lastSaveAgoSec=null、inProgress=false，仍返回 triggered=true', async () => {
    const client = createFakeClient()
    client.info.mockRejectedValue(new Error('CONNECTION RESET'))
    client.configGet.mockImplementation(async (key: string) =>
      key === 'dir' ? { dir: '/data' } : { dbfilename: 'dump.rdb' },
    )
    mockStat.mockResolvedValue({ size: 512 })
    mockGetRedis.mockReturnValue(client)
    const { triggerRedisBackup } = await loadService()

    const res = await triggerRedisBackup()

    expect(res.triggered).toBe(true)
    expect(res.lastSaveAgoSec).toBeNull()
    expect(res.inProgress).toBe(false)
    expect(res.rdbSizeBytes).toBe(512)
  })
})

// ============ ⑤ Redis 不可用 ============

describe('triggerRedisBackup - Redis 不可用', () => {
  it('getRedis()=null → 抛业务错误（由接口转 validateError 500）', async () => {
    mockGetRedis.mockReturnValue(null)
    const { triggerRedisBackup } = await loadService()

    await expect(triggerRedisBackup()).rejects.toThrow('Redis 未就绪')
  })
})

// ============ ⑥ 端点权限门禁 ============

describe('端点权限门禁 - redis-backup.post', () => {
  it('缺少 ops_backup 权限 → 403，不触发 BGSAVE', async () => {
    mockEnsurePermission.mockReturnValue({ code: 403, message: '无该操作权限', data: undefined })
    mockTriggerRedisBackup.mockResolvedValue({
      triggered: true,
      lastSaveAgoSec: 42,
      inProgress: false,
      rdbSizeBytes: null,
    })
    vi.doMock('#server/services/permission', () => ({
      ensurePermission: mockEnsurePermission,
    }))
    vi.doMock('#server/services/redisBackup', () => ({
      triggerRedisBackup: mockTriggerRedisBackup,
    }))
    vi.resetModules()
    const mod = await import('../../api/admin/monitor/redis-backup.post')

    const event = { context: { user: { id: 1, role: 1, permissions: [] } } } as unknown as H3Event
    const res = await mod.default(event)

    expect(res.code).toBe(403)
    expect(mockEnsurePermission).toHaveBeenCalledWith(event, 'ops_backup')
    expect(mockTriggerRedisBackup).not.toHaveBeenCalled()
  })
})
