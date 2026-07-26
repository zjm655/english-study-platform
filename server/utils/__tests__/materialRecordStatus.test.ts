import { describe, it, expect, vi, beforeEach } from 'vitest'

import {
  fetchRecordStatuses,
  fetchQueuedSnapshot,
  countAheadInSnapshot,
} from '../materialRecordStatus'

// ===== materialRecordStatus 测试 =====
// 覆盖：IN 批量查询 / 用户过滤（防 IDOR） / queuedAhead 快照计算 / 无排队项不拉快照

const { mockQuery } = vi.hoisted(() => ({ mockQuery: vi.fn() }))
vi.mock('../db', () => ({ query: mockQuery }))

beforeEach(() => {
  vi.clearAllMocks()
})

describe('countAheadInSnapshot', () => {
  it('计数快照中 id 更小的项', () => {
    expect(countAheadInSnapshot([1, 3, 5, 9], 5)).toBe(2)
    expect(countAheadInSnapshot([1, 3, 5, 9], 1)).toBe(0)
    expect(countAheadInSnapshot([], 7)).toBe(0)
  })
})

describe('fetchRecordStatuses', () => {
  it('空 ids 直接返回空数组且不查库', async () => {
    const items = await fetchRecordStatuses([])
    expect(items).toEqual([])
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('传 userId 时 SQL 追加 user_id 过滤（防 IDOR）', async () => {
    mockQuery.mockResolvedValue([])
    await fetchRecordStatuses([1, 2], 42)
    const [sql, params] = mockQuery.mock.calls[0]!
    expect(String(sql)).toContain('id IN (?,?)')
    expect(String(sql)).toContain('AND user_id = ?')
    expect(params).toEqual([1, 2, 42])
  })

  it('管理端不传 userId 时无用户过滤', async () => {
    mockQuery.mockResolvedValue([])
    await fetchRecordStatuses([7])
    const [sql, params] = mockQuery.mock.calls[0]!
    expect(String(sql)).not.toContain('user_id')
    expect(params).toEqual([7])
  })

  it('无 queued 项时不拉快照（仅一次查询）', async () => {
    mockQuery.mockResolvedValue([
      { id: 1, status: 'success', error_message: null, segment_id: 9, title: 'A' },
      { id: 2, status: 'processing', error_message: null, segment_id: null, title: 'B' },
    ])
    const items = await fetchRecordStatuses([1, 2], 42)
    expect(mockQuery).toHaveBeenCalledTimes(1)
    expect(items.every((i) => i.queuedAhead === undefined)).toBe(true)
  })

  it('queued 项经一次快照计算 queuedAhead', async () => {
    mockQuery
      .mockResolvedValueOnce([
        { id: 5, status: 'queued', error_message: null, segment_id: null, title: 'A' },
        { id: 9, status: 'queued', error_message: null, segment_id: null, title: 'B' },
        { id: 2, status: 'failed', error_message: 'x', segment_id: null, title: 'C' },
      ])
      .mockResolvedValueOnce([{ id: 3 }, { id: 5 }, { id: 8 }, { id: 9 }])
    const items = await fetchRecordStatuses([5, 9, 2], 42)
    // 主查询 + 快照，共两次
    expect(mockQuery).toHaveBeenCalledTimes(2)
    expect(items.find((i) => i.id === 5)?.queuedAhead).toBe(1) // 前方 id=3
    expect(items.find((i) => i.id === 9)?.queuedAhead).toBe(3) // 前方 3/5/8
    expect(items.find((i) => i.id === 2)?.queuedAhead).toBeUndefined()
  })
})

describe('fetchQueuedSnapshot', () => {
  it('返回按 id 升序的排队 id 列表', async () => {
    mockQuery.mockResolvedValue([{ id: 1 }, { id: 4 }])
    const snapshot = await fetchQueuedSnapshot()
    expect(snapshot).toEqual([1, 4])
    expect(String(mockQuery.mock.calls[0]![0])).toContain(`status = 'queued'`)
  })
})
