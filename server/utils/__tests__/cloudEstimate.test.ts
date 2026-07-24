import { describe, it, expect, vi, beforeEach } from 'vitest'

import { estimateServiceUsage } from '../cloudEstimate'

// cloudEstimate 内部用 query 聚合 api_call_log，mock 掉 db.query 隔离逻辑。
// vi.hoisted / vi.mock 会被 vitest 提升到 import 之上，故功能不受书写顺序影响。
const { mockQuery } = vi.hoisted(() => ({ mockQuery: vi.fn() }))
vi.mock('../db', () => ({ query: mockQuery }))

beforeEach(() => {
  vi.clearAllMocks()
})

describe('cloudEstimate - 分组聚合 + 成功计费', () => {
  it('单条聚合查询：只调用 query 一次', async () => {
    mockQuery.mockResolvedValueOnce([])
    await estimateServiceUsage('oss', 7)
    expect(mockQuery).toHaveBeenCalledTimes(1)
  })

  it('edu：仅成功调用计费，单价 0.004，携带 label', async () => {
    mockQuery.mockResolvedValueOnce([
      { route_pattern: '/api/evaluation/auth', method: 'POST', ok_cnt: 100, fail_cnt: 20 },
    ])
    const res = await estimateServiceUsage('edu', 7)
    expect(res.totalCalls).toBe(100) // 失败 20 不计
    expect(res.totalEstimatedCost).toBeCloseTo(0.4, 3)
    expect(res.byPath).toHaveLength(1)
    expect(res.byPath[0]!.label).toBe('口语评测鉴权')
    expect(res.byPath[0]!.unitPrice).toBe(0.004)
  })

  it('oss：多路径拆分行，按成功次数聚合', async () => {
    mockQuery.mockResolvedValueOnce([
      { route_pattern: '/api/recording', method: 'POST', ok_cnt: 10, fail_cnt: 2 },
      { route_pattern: '/api/segment/upload', method: 'POST', ok_cnt: 5, fail_cnt: 0 },
      { route_pattern: '/api/admin/segment/upload', method: 'POST', ok_cnt: 3, fail_cnt: 1 },
    ])
    const res = await estimateServiceUsage('oss', 30)
    expect(res.byPath).toHaveLength(3)
    expect(res.totalCalls).toBe(18) // 10 + 5 + 3（失败不计）
  })

  it('无记录时各路径计数为 0，总费用为 0', async () => {
    mockQuery.mockResolvedValueOnce([])
    const res = await estimateServiceUsage('nls', 7)
    expect(res.totalCalls).toBe(0)
    expect(res.totalEstimatedCost).toBe(0)
    expect(res.byPath.every((p) => p.count === 0)).toBe(true)
  })

  it('SUM 返回字符串（mysql2 DECIMAL）也能正确解析', async () => {
    mockQuery.mockResolvedValueOnce([
      { route_pattern: '/api/evaluation/auth', method: 'POST', ok_cnt: '50', fail_cnt: '5' },
    ])
    const res = await estimateServiceUsage('edu', 7)
    expect(res.totalCalls).toBe(50)
  })
})
