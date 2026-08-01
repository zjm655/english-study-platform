/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest'

import handler from '../analyze-fail.post'

// handler 级集成测试：覆盖 analyze-fail 端点的登录校验、id 校验、录音归属、
// 事务内 UPDATE+SELECT+signUrl 全流程、事务失败兜底。走真实 validate schema。

vi.hoisted(() => {
  // Nuxt 自动导入的符号在 vitest node 环境需手动挂全局
  ;(globalThis as any).defineEventHandler = (handler: any) => handler
  ;(globalThis as any).getRouterParam = (event: any, name: string) => event.__params?.[name]
  ;(globalThis as any).getRequestHeader = (event: any, name: string) =>
    event.__headers?.[name]
  ;(globalThis as any).logger = { error: () => {}, warn: () => {}, info: () => {} }
  ;(globalThis as any).validateError = (message: string, code: number = 400) => ({
    code,
    message,
    data: undefined,
  })
  ;(globalThis as any).validateSuccess = (data: unknown, message?: string) => ({
    code: 200,
    message,
    data,
  })
})

const { mockQuery, mockWithTransaction, mockConn, mockSignUrl, mockRowToRecording } = vi.hoisted(
  () => {
    const mockConn = { execute: vi.fn() }
    return {
      mockQuery: vi.fn(),
      mockConn,
      // withTransaction 真实实现：获取连接 → begin → fn(conn) → commit；mock 简化为直接调用 fn
      mockWithTransaction: vi.fn(async (fn: any) => fn(mockConn)),
      mockSignUrl: vi.fn().mockResolvedValue('https://signed/url'),
      mockRowToRecording: vi.fn((row: any, path: any) => ({
        id: row?.id,
        audioPath: path,
        analyzeStatus: 'failed',
      })),
    }
  },
)

vi.mock('#server/utils/db', () => ({
  query: mockQuery,
  withTransaction: mockWithTransaction,
}))
vi.mock('#server/utils/oss', () => ({
  signUrl: mockSignUrl,
  RECORDING_EXPIRE: 3600,
}))
vi.mock('#server/utils/recording', () => ({
  rowToRecording: mockRowToRecording,
}))

// ============ 辅助 ============

const USER = { id: 1 }

function makeEvent(opts: { user?: any; params?: Record<string, string> } = {}) {
  return {
    context: { user: opts.user },
    __params: opts.params,
  } as any
}

const RECORDING_ROW = {
  id: 5,
  user_id: 1,
  segment_id: 1,
  phase: 3,
  media_id: 1,
  score: null,
  feedback: null,
  recognizedText: null,
  wordScores: null,
  rawResult: null,
  duration: '5.00',
  analyze_status: 'pending',
  createdAt: '2026-01-01',
  deleted_at: null,
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ============ 未登录 / 无效参数 ============

describe('analyze-fail - 未登录/无效参数', () => {
  it('未登录 → 401', async () => {
    const res = await handler(makeEvent({ user: undefined }))
    expect(res.code).toBe(401)
    expect(res.message).toContain('未登录')
  })

  it('id 为 NaN（abc）→ 400', async () => {
    const res = await handler(makeEvent({ user: USER, params: { id: 'abc' } }))
    expect(res.code).toBe(400)
    expect(res.message).toContain('录音ID')
  })

  it('params 未传 id → 400', async () => {
    const res = await handler(makeEvent({ user: USER, params: {} }))
    expect(res.code).toBe(400)
  })
})

// ============ 录音归属校验 ============

describe('analyze-fail - 录音归属校验', () => {
  it('录音不存在 → 404', async () => {
    mockQuery.mockResolvedValueOnce([])
    const res = await handler(makeEvent({ user: USER, params: { id: '5' } }))
    expect(res.code).toBe(404)
    expect(res.message).toContain('不存在')
  })

  it('非本人录音 → 403', async () => {
    mockQuery.mockResolvedValueOnce([{ ...RECORDING_ROW, user_id: 999 }])
    const res = await handler(makeEvent({ user: USER, params: { id: '5' } }))
    expect(res.code).toBe(403)
    expect(res.message).toContain('无权限')
  })
})

// ============ 标记成功 ============

describe('analyze-fail - 标记成功', () => {
  it('成功标记 → 200，UPDATE SQL 含 analyze_status = failed', async () => {
    mockQuery.mockResolvedValueOnce([RECORDING_ROW]) // 查录音归属
    // 事务内：第一次 UPDATE（返回值未被使用），第二次 SELECT 回查
    // mysql2 conn.execute(SELECT) 返回 [rows, fields] 元组，源码解构 [rows]
    mockConn.execute.mockResolvedValueOnce({ affectedRows: 1 }) // UPDATE
    mockConn.execute.mockResolvedValueOnce([[{ ...RECORDING_ROW, rec_media_key: 'audio/xxx.ogg' }]]) // SELECT: [rows, fields]

    const res = await handler(makeEvent({ user: USER, params: { id: '5' } }))

    expect(res.code).toBe(200)
    expect(res.data).toBeTruthy()
    expect(res.message).toContain('已标记为分析失败')
    // 验证 UPDATE SQL
    const updateSql = mockConn.execute.mock.calls[0]![0] as string
    expect(updateSql).toContain("analyze_status = 'failed'")
    expect(updateSql).toContain('WHERE id = ? AND user_id = ?')
    // 验证 signUrl 被调用（media_key 非空）
    expect(mockSignUrl).toHaveBeenCalledWith('audio/xxx.ogg', 3600)
    // 验证 rowToRecording 被调用
    expect(mockRowToRecording).toHaveBeenCalled()
  })
})

// ============ 事务失败 ============

describe('analyze-fail - 事务失败', () => {
  it('withTransaction 抛错 → 500', async () => {
    mockQuery.mockResolvedValueOnce([RECORDING_ROW]) // 查录音归属通过
    mockWithTransaction.mockImplementationOnce(async () => {
      throw new Error('tx fail')
    })

    const res = await handler(makeEvent({ user: USER, params: { id: '5' } }))

    expect(res.code).toBe(500)
    expect(res.message).toContain('标记失败')
  })
})
