import { describe, it, expect, vi, beforeEach } from 'vitest'

import { archiveLogs, purgeArchive, ARCHIVABLE_TABLES } from '../logArchive'

// ===== logArchive 测试 =====
// 覆盖：白名单拒绝非法表名 / 单批迁移的 INSERT+DELETE 同 id 集合 / 分批循环终止 / purge 分批计数

const { mockQuery, mockConnQuery } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockConnQuery: vi.fn(),
}))

vi.mock('#server/utils/db', () => ({
  query: mockQuery,
  // withTransaction 直接以假连接执行回调（事务语义不在本测试范围）
  withTransaction: (fn: (conn: unknown) => Promise<unknown>) => fn({ query: mockConnQuery }),
}))

beforeEach(() => {
  vi.clearAllMocks()
})

describe('ARCHIVABLE_TABLES', () => {
  it('三张日志表均有归档映射且列清单以 id 开头、以 createdAt 结尾', () => {
    for (const table of ['api_call_log', 'cloud_service_call_log', 'admin_operation_log']) {
      const cfg = ARCHIVABLE_TABLES[table]!
      expect(cfg.archiveTable).toBe(`${table}_archive`)
      expect(cfg.columns[0]).toBe('id')
      expect(cfg.columns[cfg.columns.length - 1]).toBe('createdAt')
    }
  })
})

describe('archiveLogs', () => {
  it('非法表名直接抛错且不触碰数据库', async () => {
    await expect(archiveLogs('user', 90)).rejects.toThrow('不支持归档的表名')
    expect(mockConnQuery).not.toHaveBeenCalled()
  })

  it('单批：INSERT IGNORE 与 DELETE 使用同一 id 集合', async () => {
    mockConnQuery
      .mockResolvedValueOnce([[{ id: 3 }, { id: 7 }], undefined]) // SELECT id
      .mockResolvedValueOnce([{}, undefined]) // INSERT IGNORE
      .mockResolvedValueOnce([{}, undefined]) // DELETE
    const total = await archiveLogs('cloud_service_call_log', 90)

    expect(total).toBe(2)
    expect(mockConnQuery).toHaveBeenCalledTimes(3)
    const [selectSql, selectParams] = mockConnQuery.mock.calls[0]!
    expect(String(selectSql)).toContain('SELECT id FROM `cloud_service_call_log`')
    expect(String(selectSql)).toContain('DATE_SUB(NOW(), INTERVAL ? DAY)')
    expect(selectParams).toEqual([90])

    const [insertSql, insertParams] = mockConnQuery.mock.calls[1]!
    expect(String(insertSql)).toContain('INSERT IGNORE INTO `cloud_service_call_log_archive`')
    expect(String(insertSql)).toContain('WHERE id IN (?,?)')
    expect(insertParams).toEqual([3, 7])

    const [deleteSql, deleteParams] = mockConnQuery.mock.calls[2]!
    expect(String(deleteSql)).toContain('DELETE FROM `cloud_service_call_log` WHERE id IN (?,?)')
    expect(deleteParams).toEqual([3, 7])
  })

  it('无匹配行时返回 0 且不执行 INSERT/DELETE', async () => {
    mockConnQuery.mockResolvedValueOnce([[], undefined])
    const total = await archiveLogs('api_call_log', 30)
    expect(total).toBe(0)
    expect(mockConnQuery).toHaveBeenCalledTimes(1)
  })

  it('满批后继续下一批，未满批终止并累计行数', async () => {
    vi.useFakeTimers()
    try {
      // 第一批返回满 10000 个 id，第二批返回 2 个后终止
      const fullBatch = Array.from({ length: 10000 }, (_, i) => ({ id: i + 1 }))
      mockConnQuery
        .mockResolvedValueOnce([fullBatch, undefined])
        .mockResolvedValueOnce([{}, undefined])
        .mockResolvedValueOnce([{}, undefined])
        .mockResolvedValueOnce([[{ id: 10001 }, { id: 10002 }], undefined])
        .mockResolvedValueOnce([{}, undefined])
        .mockResolvedValueOnce([{}, undefined])

      const promise = archiveLogs('api_call_log', 90)
      await vi.runAllTimersAsync() // 跳过批次间 100ms sleep
      const total = await promise

      expect(total).toBe(10002)
      expect(mockConnQuery).toHaveBeenCalledTimes(6)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('purgeArchive', () => {
  it('非法表名抛错', async () => {
    await expect(purgeArchive('media', 90)).rejects.toThrow('不支持归档的表名')
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('目标为归档表且按 createdAt 过滤，未满批即终止', async () => {
    mockQuery.mockResolvedValueOnce({ affectedRows: 5 })
    const total = await purgeArchive('admin_operation_log', 180)

    expect(total).toBe(5)
    expect(mockQuery).toHaveBeenCalledTimes(1)
    const [sql, params] = mockQuery.mock.calls[0]!
    expect(String(sql)).toContain('DELETE FROM `admin_operation_log_archive`')
    expect(String(sql)).toContain('createdAt < DATE_SUB(NOW(), INTERVAL ? DAY)')
    expect(params).toEqual([180])
  })

  it('满批继续删除并累计', async () => {
    vi.useFakeTimers()
    try {
      mockQuery
        .mockResolvedValueOnce({ affectedRows: 10000 })
        .mockResolvedValueOnce({ affectedRows: 42 })

      const promise = purgeArchive('api_call_log', 365)
      await vi.runAllTimersAsync()
      const total = await promise

      expect(total).toBe(10042)
      expect(mockQuery).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })
})
