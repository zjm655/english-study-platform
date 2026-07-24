/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest'

import handler from '../[recordingId].post'
import { PERMISSIONS } from '#shared/utils/permission'

// handler 级集成测试：审核门禁——查看用户录音评测详情。
// 覆盖 无 REVIEW→403 不查库、录音不存在/跨用户→404 不签名、缺 reason→400 不签名、
// 留痕失败→500 不签名、成功→先留痕后签名并返回完整详情。
// 走真实 permission.ts（ensurePermission/writeReviewAccessLog）与 recording.ts，mock db/oss/h3。

vi.hoisted(() => {
  ;(globalThis as any).defineEventHandler = (handler: any) => handler
  ;(globalThis as any).getRouterParam = (event: any, name: string) => event.__params?.[name]
  ;(globalThis as any).logger = { error: () => {}, warn: () => {}, info: () => {} }
})

const { mockQuery, mockSignUrl, mockReadBody } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockSignUrl: vi.fn(),
  mockReadBody: vi.fn(),
}))

vi.mock('#server/utils/db', () => ({ query: mockQuery }))
vi.mock('#server/utils/oss', () => ({
  signUrl: mockSignUrl,
  RECORDING_EXPIRE: 2400,
  MATERIAL_EXPIRE: 2100,
}))
vi.mock('h3', () => ({ readBody: mockReadBody, getRequestIP: () => '10.0.0.1' }))

const REVIEWER = { id: 1, role: 1, permissions: [PERMISSIONS.REVIEW] }

// 一条完整的 recording 行（含联表字段），供成功用例使用
const FULL_ROW = {
  id: 10,
  user_id: 7,
  segment_id: 3,
  phase: 3,
  media_id: 5,
  score: '88.00',
  feedback: '发音清晰',
  recognizedText: 'hello world',
  wordScores: [{ word: 'hello', score: 90, status: 'correct' }],
  rawResult: '{}',
  duration: '12.50',
  analyze_status: 'success',
  createdAt: '2026-07-20 10:00:00',
  deleted_at: null,
  rec_media_key: 'rec/obj.ogg',
  segmentTitle: 'Segment A',
  referenceText: 'hello world reference',
}

function makeEvent(opts: { user?: unknown; params?: Record<string, string> } = {}) {
  return { context: { user: opts.user }, __params: opts.params } as any
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('审核门禁 - 用户录音详情 [recordingId].post', () => {
  it('无 REVIEW 权限 → 403，且不查库', async () => {
    const res = await handler(
      makeEvent({
        user: { id: 2, role: 1, permissions: [] },
        params: { userId: '7', recordingId: '10' },
      }),
    )
    expect(res.code).toBe(403)
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('录音不存在或不属于该用户 → 404，且不签名', async () => {
    mockQuery.mockResolvedValueOnce([]) // SELECT 命中空
    const res = await handler(
      makeEvent({ user: REVIEWER, params: { userId: '7', recordingId: '999' } }),
    )
    expect(res.code).toBe(404)
    expect(mockSignUrl).not.toHaveBeenCalled()
  })

  it('缺 reason → 400，且绝不签名、不留痕', async () => {
    mockQuery.mockResolvedValueOnce([FULL_ROW]) // SELECT
    mockReadBody.mockResolvedValue({ reasonCategory: '质量抽查' })
    const res = await handler(
      makeEvent({ user: REVIEWER, params: { userId: '7', recordingId: '10' } }),
    )
    expect(res.code).toBe(400)
    expect(mockSignUrl).not.toHaveBeenCalled()
    expect(mockQuery).toHaveBeenCalledTimes(1) // 仅 SELECT，未执行留痕 INSERT
  })

  it('留痕失败 → 500，且绝不签名（安全优先）', async () => {
    mockQuery.mockResolvedValueOnce([FULL_ROW]) // SELECT
    mockReadBody.mockResolvedValue({ reasonCategory: '质量抽查', reason: '核实内容合规' })
    mockQuery.mockRejectedValueOnce(new Error('insert fail')) // writeReviewAccessLog
    const res = await handler(
      makeEvent({ user: REVIEWER, params: { userId: '7', recordingId: '10' } }),
    )
    expect(res.code).toBe(500)
    expect(mockSignUrl).not.toHaveBeenCalled()
  })

  it('成功：先留痕后签名，返回完整评测详情', async () => {
    mockQuery.mockResolvedValueOnce([FULL_ROW]) // SELECT
    mockReadBody.mockResolvedValue({ reasonCategory: '质量抽查', reason: '核实内容合规' })
    mockQuery.mockResolvedValueOnce({ insertId: 1 }) // writeReviewAccessLog
    mockSignUrl.mockResolvedValueOnce('https://signed-rec')
    const res = await handler(
      makeEvent({ user: REVIEWER, params: { userId: '7', recordingId: '10' } }),
    )
    expect(res.code).toBe(200)
    expect(mockSignUrl).toHaveBeenCalledWith('rec/obj.ogg', 2400)
    expect(res.data!.recording.audioPath).toBe('https://signed-rec')
    expect(res.data!.recording.recognizedText).toBe('hello world')
    expect(res.data!.recording.score).toBe(88)
    expect(res.data!.segmentTitle).toBe('Segment A')
    expect(res.data!.referenceText).toBe('hello world reference')
  })
})
