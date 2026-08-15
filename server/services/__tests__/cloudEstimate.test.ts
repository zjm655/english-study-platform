import { describe, it, expect, vi, beforeEach } from 'vitest'

import { estimateServiceUsage } from '../cloudEstimate'

// cloudEstimate 内部用 query 聚合 api_call_log，mock 掉 db.query 隔离逻辑。
// vi.hoisted / vi.mock 会被 vitest 提升到 import 之上，故功能不受书写顺序影响。
const { mockQuery } = vi.hoisted(() => ({ mockQuery: vi.fn() }))
vi.mock('#server/utils/db', () => ({ query: mockQuery }))

beforeEach(() => {
  vi.clearAllMocks()
})

describe('cloudEstimate - 分组聚合 + 成功计费', () => {
  it('单条聚合查询：非 OSS 产品只调用 query 一次', async () => {
    mockQuery.mockResolvedValueOnce([])
    await estimateServiceUsage('edu', 7)
    expect(mockQuery).toHaveBeenCalledTimes(1)
  })

  it('edu：仅成功调用计费，单价 0.004，携带 label（P2 起走 cloud_service_call_log 精确统计）', async () => {
    mockQuery.mockResolvedValueOnce([{ ok: 100 }])
    const res = await estimateServiceUsage('edu', 7)
    expect(res.totalCalls).toBe(100) // 失败不计（口径：success=1）
    expect(res.totalEstimatedCost).toBeCloseTo(0.4, 3)
    expect(res.byPath).toHaveLength(1)
    expect(res.byPath[0]!.label).toBe('口语评测鉴权 (warrant)')
    expect(res.byPath[0]!.unitPrice).toBe(0.004)
  })

  it('oss：多路径拆分行 + 追加前端播放(外网下行)行，两次查询', async () => {
    mockQuery
      .mockResolvedValueOnce([
        { route_pattern: '/api/recording', method: 'POST', ok_cnt: 10, fail_cnt: 2 },
        { route_pattern: '/api/segment/upload', method: 'POST', ok_cnt: 5, fail_cnt: 0 },
        { route_pattern: '/api/admin/segment/upload', method: 'POST', ok_cnt: 3, fail_cnt: 1 },
      ])
      .mockResolvedValueOnce([{ cnt: 200 }]) // oss_playback_daily 窗口内播放总量
    const res = await estimateServiceUsage('oss', 30)
    expect(mockQuery).toHaveBeenCalledTimes(2) // 聚合查询 + 播放汇总查询
    expect(res.byPath).toHaveLength(4) // 3 上传 + 1 前端播放
    const playback = res.byPath.find((p) => p.path === '/api/oss/playback')
    expect(playback).toBeTruthy()
    expect(playback!.count).toBe(200)
    expect(res.totalCalls).toBe(218) // 上传 18(10+5+3) + 播放 200
  })

  it('无记录时各路径计数为 0，总费用为 0', async () => {
    mockQuery.mockResolvedValueOnce([])
    const res = await estimateServiceUsage('nls', 7)
    expect(res.totalCalls).toBe(0)
    expect(res.totalEstimatedCost).toBe(0)
    expect(res.byPath).toHaveLength(0)
    expect(res.bizDurationMs).toBe(0)
  })

  it('SUM 返回字符串（mysql2 DECIMAL）也能正确解析', async () => {
    mockQuery.mockResolvedValueOnce([{ ok: '50' }])
    const res = await estimateServiceUsage('edu', 7)
    expect(res.totalCalls).toBe(50)
  })
})

describe('cloudEstimate - NLS 按音频时长计费（cloud_service_call_log 真实埋点）', () => {
  it('nls 走专用聚合：按 operation 分行，费用 = SUM(biz_duration_ms) × 2.5 元/小时', async () => {
    // filetrans 3 次共 12 分钟（720000ms），speechToText 2 次共 3 分钟（180000ms）
    mockQuery.mockResolvedValueOnce([
      { operation: 'filetrans', call_count: 3, biz_ms: 720000 },
      { operation: 'speechToText', call_count: 2, biz_ms: 180000 },
    ])
    const res = await estimateServiceUsage('nls', 7)
    expect(mockQuery).toHaveBeenCalledTimes(1)
    expect(res.totalCalls).toBe(5)
    expect(res.bizDurationMs).toBe(900000) // 15 分钟
    // 900000ms = 0.25 小时 × 2.5 元 = 0.625 元
    expect(res.totalEstimatedCost).toBeCloseTo(0.625, 3)
    expect(res.unit).toBe('小时')
    expect(res.byPath).toHaveLength(2)
    const filetrans = res.byPath.find((p) => p.path === 'nls:filetrans')!
    expect(filetrans.bizDurationMs).toBe(720000)
    expect(filetrans.estimatedCost).toBeCloseTo(0.5, 3)
  })

  it('nls 聚合 SQL 仅统计成功识别调用（filetrans/speechToText），排除 createToken/sttFallback', async () => {
    mockQuery.mockResolvedValueOnce([])
    await estimateServiceUsage('nls', 30)
    const sql = mockQuery.mock.calls[0]![0] as string
    expect(sql).toContain("operation IN ('filetrans', 'speechToText')")
    expect(sql).toContain("service = 'nls'")
    expect(sql).toContain('success = 1')
    expect(sql).toContain('SUM(biz_duration_ms)')
    const params = mockQuery.mock.calls[0]![1]
    expect(params).toEqual([30])
  })
})
