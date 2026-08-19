import { describe, it, expect, vi, beforeEach } from 'vitest'

import { getMySqlMonitorResult } from '../mysqlMonitor'

// ===== mysqlMonitor 测试 =====
// 覆盖：正常聚合（版本/连接数/表大小大写列映射/totalSizeBytes 求和/appPoolLimit）
// 与 DB 不可达时的整体降级（online=false + error，绝不抛错）。

const { mockQuery } = vi.hoisted(() => ({ mockQuery: vi.fn() }))
vi.mock('#server/utils/db', () => ({ query: mockQuery, DB_POOL_LIMIT: 10 }))

beforeEach(() => {
  vi.clearAllMocks()
})

describe('getMySqlMonitorResult', () => {
  it('正常读取：按序 mock 四次查询并聚合', async () => {
    mockQuery
      .mockResolvedValueOnce([{ v: '8.0.36' }]) // SELECT VERSION()
      .mockResolvedValueOnce([
        // SHOW GLOBAL STATUS
        { Variable_name: 'Uptime', Value: '12345' },
        { Variable_name: 'Threads_connected', Value: '3' },
        { Variable_name: 'Max_used_connections', Value: '9' },
      ])
      .mockResolvedValueOnce([{ Variable_name: 'max_connections', Value: '151' }])
      .mockResolvedValueOnce([
        // information_schema.TABLES（列名恒为大写，值为字符串或数字均可）
        { TABLE_NAME: 'users', TABLE_ROWS: '100', DATA_LENGTH: '2048', INDEX_LENGTH: '1024' },
        { TABLE_NAME: 'segments', TABLE_ROWS: 50, DATA_LENGTH: 4096, INDEX_LENGTH: 2048 },
      ])

    const result = await getMySqlMonitorResult()

    expect(result.online).toBe(true)
    expect(result.version).toBe('8.0.36')
    expect(result.uptimeSec).toBe(12345)
    expect(result.connections).toBe(3)
    expect(result.maxUsedConnections).toBe(9)
    expect(result.maxConnections).toBe(151)
    expect(result.appPoolLimit).toBe(10)
    // totalSizeBytes = (2048+1024) + (4096+2048) = 9216
    expect(result.totalSizeBytes).toBe(9216)
    expect(result.tables).toEqual([
      { name: 'users', rows: 100, dataBytes: 2048, indexBytes: 1024 },
      { name: 'segments', rows: 50, dataBytes: 4096, indexBytes: 2048 },
    ])
    expect(result.error).toBeUndefined()

    // 表大小查询走 information_schema 且过滤非 BASE TABLE
    const tableSql = String(mockQuery.mock.calls[3]![0])
    expect(tableSql).toContain('information_schema.TABLES')
    expect(tableSql).toContain("TABLE_TYPE = 'BASE TABLE'")
  })

  it('DB 不可达：整体降级 online=false 且不抛错', async () => {
    mockQuery.mockRejectedValue(new Error('connect ECONNREFUSED'))

    const result = await getMySqlMonitorResult()

    expect(result.online).toBe(false)
    expect(result.error).toBe('connect ECONNREFUSED')
    expect(mockQuery).toHaveBeenCalled()
  })

  it('DB 不可达（空错误消息）：error 回落为「MySQL 不可用」', async () => {
    mockQuery.mockRejectedValue(new Error(''))

    const result = await getMySqlMonitorResult()

    expect(result.online).toBe(false)
    expect(result.error).toBe('MySQL 不可用')
  })
})
