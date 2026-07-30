/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest'

import segmentBatchHandler from '../segment/batch.post'
import unitBatchHandler from '../unit/batch.post'
import recordBatchHandler from '../material/records/batch.post'
import userBatchHandler from '../user/batch.post'
import reprocessHandler from '../material/records/[id]/reprocess.post'
import recordDeleteHandler from '../material/records/[id].delete'
import { PERMISSIONS } from '#shared/utils/permission'

// handler 级集成测试：覆盖四个批量端点的权限门禁、zod 上限/去重、护栏过滤进 skipped、
// IN 批量 SQL、reprocess 容量截断，以及单条端点补上的容量检查与进行中删除护栏。
// 走真实 validate schema 与真实 permission 判定。

vi.hoisted(() => {
  ;(globalThis as any).defineEventHandler = (handler: any) => handler
  ;(globalThis as any).getQuery = (event: any) => event.__query ?? {}
  ;(globalThis as any).getRouterParam = (event: any, name: string) => event.__params?.[name]
  ;(globalThis as any).logger = { error: () => {}, warn: () => {}, info: () => {} }
})

const {
  mockQuery,
  mockWithTransaction,
  mockConnExecute,
  mockReadBody,
  mockLogAdminOperation,
  mockReprocessRecord,
  mockIsUploadQueueFull,
} = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockWithTransaction: vi.fn(),
  mockConnExecute: vi.fn(),
  mockReadBody: vi.fn(),
  mockLogAdminOperation: vi.fn(),
  mockReprocessRecord: vi.fn(),
  mockIsUploadQueueFull: vi.fn(),
}))

vi.mock('#server/utils/db', () => ({
  query: mockQuery,
  withTransaction: mockWithTransaction,
}))
vi.mock('h3', () => ({ readBody: mockReadBody }))
vi.mock('#server/utils/oss', () => ({ signUrl: vi.fn(), MATERIAL_EXPIRE: 2100 }))
vi.mock('#server/services/adminLog', () => ({ logAdminOperation: mockLogAdminOperation }))
vi.mock('#server/services/materialReprocess', () => ({ reprocessRecord: mockReprocessRecord }))
vi.mock('#server/services/materialJob', () => ({
  isUploadQueueFull: mockIsUploadQueueFull,
  updateRecordFailed: vi.fn(),
}))
// 上传限制已抽入 sys_config（uploadLimitChecker），mock 掉避免真实查库；队列深度固定 50
vi.mock('#server/utils/uploadLimitChecker', () => ({
  getUploadLimits: vi.fn().mockResolvedValue({
    maxAudioDurationUser: 180,
    maxAudioDurationAdmin: 600,
    maxAudioSizeUser: 2 * 1024 * 1024,
    maxAudioSizeAdmin: 5 * 1024 * 1024,
    recordingMaxSize: 50 * 1024 * 1024,
    uploadQueueMax: 50,
  }),
}))

const ADMIN = { id: 1, role: 1, permissions: [PERMISSIONS.MANAGE_MATERIALS] }
const USER_ADMIN = { id: 1, role: 1, permissions: [PERMISSIONS.MANAGE_USERS] }

function makeEvent(opts: { user?: unknown; params?: Record<string, string>; body?: unknown } = {}) {
  return { context: { user: opts.user }, __params: opts.params, __body: opts.body } as any
}

beforeEach(() => {
  vi.clearAllMocks()
  mockWithTransaction.mockImplementation(async (fn: any) => fn({ execute: mockConnExecute }))
  mockReadBody.mockImplementation(async (event: any) => event.__body)
  mockIsUploadQueueFull.mockResolvedValue(false)
})

// ============ 权限门禁 ============

describe('批量端点 - 权限门禁', () => {
  it('非管理员调用四个批量端点均返回 403', async () => {
    const user = { id: 2, role: 0 }
    const body = { action: 'delete', ids: [1] }
    expect((await segmentBatchHandler(makeEvent({ user, body }))).code).toBe(403)
    expect((await unitBatchHandler(makeEvent({ user, body }))).code).toBe(403)
    expect((await recordBatchHandler(makeEvent({ user, body }))).code).toBe(403)
    expect(
      (await userBatchHandler(makeEvent({ user, body: { action: 'ban', ids: [1] } }))).code,
    ).toBe(403)
  })
})

// ============ zod 校验：上限 / 去重 / 非法值 ============

describe('批量端点 - 参数校验', () => {
  it('ids 为空数组返回 400', async () => {
    const res = await segmentBatchHandler(
      makeEvent({ user: ADMIN, body: { action: 'delete', ids: [] } }),
    )
    expect(res.code).toBe(400)
  })

  it('ids 超过 100 个返回 400', async () => {
    const ids = Array.from({ length: 101 }, (_, i) => i + 1)
    const res = await segmentBatchHandler(
      makeEvent({ user: ADMIN, body: { action: 'delete', ids } }),
    )
    expect(res.code).toBe(400)
  })

  it('ids 含 0 或负数返回 400（保留单元 id=0 在 schema 层即被拒）', async () => {
    const res = await unitBatchHandler(
      makeEvent({ user: ADMIN, body: { action: 'delete', ids: [0, 1] } }),
    )
    expect(res.code).toBe(400)
  })

  it('reprocess ids 超过 20 个返回 400', async () => {
    const ids = Array.from({ length: 21 }, (_, i) => i + 1)
    const res = await recordBatchHandler(
      makeEvent({ user: ADMIN, body: { action: 'reprocess', ids, unitId: 0 } }),
    )
    expect(res.code).toBe(400)
  })

  it('重复 ids 去重后执行', async () => {
    mockQuery
      .mockResolvedValueOnce([{ id: 1 }]) // 预查存在集
      .mockResolvedValueOnce({ affectedRows: 1 }) // UPDATE
    const res = await segmentBatchHandler(
      makeEvent({ user: ADMIN, body: { action: 'delete', ids: [1, 1, 1] } }),
    )
    expect(res.code).toBe(200)
    // 预查参数已去重为 [1]
    expect(mockQuery.mock.calls[0]![1]).toEqual([1])
  })
})

// ============ 材料批量 delete / move ============

describe('材料批量操作', () => {
  it('delete：存在集走 UPDATE IN，差集进 skipped', async () => {
    mockQuery
      .mockResolvedValueOnce([{ id: 1 }, { id: 2 }]) // 预查：3 不存在
      .mockResolvedValueOnce({ affectedRows: 2 }) // UPDATE IN
    const res = await segmentBatchHandler(
      makeEvent({ user: ADMIN, body: { action: 'delete', ids: [1, 2, 3] } }),
    )
    expect(res.code).toBe(200)
    expect(res.data).toEqual({
      succeeded: 2,
      skipped: [{ id: 3, reason: '材料不存在或已删除' }],
    })
    const updateSql = mockQuery.mock.calls[1]![0] as string
    expect(updateSql).toContain('SET deleted_at = NOW()')
    expect(updateSql).toContain('deleted_at IS NULL')
    // 审计一批一条
    expect(mockLogAdminOperation).toHaveBeenCalledWith(
      1,
      'segment.batchDelete',
      'segment',
      0,
      expect.objectContaining({ succeeded: 2 }),
    )
  })

  it('move：目标单元不存在返回 404，不执行更新', async () => {
    mockQuery.mockResolvedValueOnce([]) // 单元预查为空
    const res = await segmentBatchHandler(
      makeEvent({ user: ADMIN, body: { action: 'move', ids: [1], unitId: 99 } }),
    )
    expect(res.code).toBe(404)
    expect(mockQuery).toHaveBeenCalledTimes(1)
  })

  it('move：unitId=0（自定义单元保留位）跳过单元查表直接更新', async () => {
    mockQuery
      .mockResolvedValueOnce([{ id: 1 }]) // 材料预查（无单元预查）
      .mockResolvedValueOnce({ affectedRows: 1 })
    const res = await segmentBatchHandler(
      makeEvent({ user: ADMIN, body: { action: 'move', ids: [1], unitId: 0 } }),
    )
    expect(res.code).toBe(200)
    const updateSql = mockQuery.mock.calls[1]![0] as string
    expect(updateSql).toContain('SET unit_id = ?')
    expect(mockQuery.mock.calls[1]![1]).toEqual([0, 1])
  })
})

// ============ 单元批量 delete ============

describe('单元批量删除', () => {
  it('统计各单元材料数写审计 detail，UPDATE IN 软删', async () => {
    mockQuery
      .mockResolvedValueOnce([{ id: 2 }, { id: 3 }]) // 存在集
      .mockResolvedValueOnce([{ unit_id: 2, total: 5 }]) // GROUP BY 材料数
      .mockResolvedValueOnce({ affectedRows: 2 }) // UPDATE
    const res = await unitBatchHandler(
      makeEvent({ user: ADMIN, body: { action: 'delete', ids: [2, 3, 4] } }),
    )
    expect(res.code).toBe(200)
    expect(res.data).toEqual({
      succeeded: 2,
      skipped: [{ id: 4, reason: '单元不存在或已删除' }],
    })
    expect(mockLogAdminOperation).toHaveBeenCalledWith(
      1,
      'unit.batchDelete',
      'unit',
      0,
      expect.objectContaining({ segmentCounts: { 2: 5 } }),
    )
  })
})

// ============ 上传记录批量 delete / reprocess ============

describe('上传记录批量操作', () => {
  it('delete：queued/processing 进 skipped，其余单事务软删 segment + 硬删 record', async () => {
    mockQuery.mockResolvedValueOnce([
      { id: 1, status: 'failed', segment_id: null },
      { id: 2, status: 'queued', segment_id: null },
      { id: 3, status: 'success', segment_id: 30 },
    ])
    const res = await recordBatchHandler(
      makeEvent({ user: ADMIN, body: { action: 'delete', ids: [1, 2, 3, 4] } }),
    )
    expect(res.code).toBe(200)
    expect(res.data!.succeeded).toBe(2)
    expect(res.data!.skipped).toEqual([
      { id: 2, reason: '任务进行中，无法删除' },
      { id: 4, reason: '记录不存在' },
    ])
    // 事务内两条语句：软删 segment IN(30) + 硬删 record IN(1,3)
    expect(mockConnExecute).toHaveBeenCalledTimes(2)
    expect(mockConnExecute.mock.calls[0]![1]).toEqual([30])
    expect(mockConnExecute.mock.calls[1]![1]).toEqual([1, 3])
  })

  it('reprocess：按 upload_queue_max 剩余容量截断，超出进 skipped「队列已满」', async () => {
    mockQuery.mockResolvedValueOnce([{ cnt: 48 }]) // 当前 queued 48，剩余容量 2
    mockReprocessRecord.mockResolvedValue({ ok: true })
    const res = await recordBatchHandler(
      makeEvent({ user: ADMIN, body: { action: 'reprocess', ids: [1, 2, 3, 4], unitId: 0 } }),
    )
    expect(res.code).toBe(200)
    expect(res.data!.succeeded).toBe(2)
    expect(mockReprocessRecord).toHaveBeenCalledTimes(2)
    expect(res.data!.skipped).toEqual([
      { id: 3, reason: '处理队列已满，请稍后再试' },
      { id: 4, reason: '处理队列已满，请稍后再试' },
    ])
  })

  it('reprocess：原子锁抢占失败（非 failed 状态）进 skipped', async () => {
    mockQuery.mockResolvedValueOnce([{ cnt: 0 }])
    mockReprocessRecord
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: false, reason: '仅失败记录可重处理，当前状态：success' })
    const res = await recordBatchHandler(
      makeEvent({ user: ADMIN, body: { action: 'reprocess', ids: [1, 2], unitId: 3 } }),
    )
    expect(res.code).toBe(200)
    expect(res.data!.succeeded).toBe(1)
    expect(res.data!.skipped).toEqual([{ id: 2, reason: '仅失败记录可重处理，当前状态：success' }])
    // unitId 透传给 reprocessRecord
    expect(mockReprocessRecord).toHaveBeenCalledWith(1, 3)
  })
})

// ============ 用户批量 ban / unban / delete ============

describe('用户批量操作', () => {
  it('护栏：自己 / 管理员 / 状态一致均进 skipped，通过集 UPDATE IN', async () => {
    mockQuery
      .mockResolvedValueOnce([
        { id: 2, role: 1, status: 1, account: 'admin2' }, // 管理员
        { id: 3, role: 0, status: 0, account: 'banned3' }, // 已封禁
        { id: 4, role: 0, status: 1, account: 'normal4' }, // 可封禁
      ])
      .mockResolvedValueOnce({ affectedRows: 1 }) // UPDATE
    const res = await userBatchHandler(
      makeEvent({ user: USER_ADMIN, body: { action: 'ban', ids: [1, 2, 3, 4, 5] } }),
    )
    expect(res.code).toBe(200)
    expect(res.data!.succeeded).toBe(1)
    expect(res.data!.skipped).toEqual([
      { id: 1, reason: '不能对自己执行此操作' },
      { id: 2, reason: '不能对管理员或超级管理员执行此操作' },
      { id: 3, reason: '该用户已处于封禁状态' },
      { id: 5, reason: '用户不存在或已注销' },
    ])
    // ban → status=0，仅对通过集 [4]
    expect(mockQuery.mock.calls[1]![1]).toEqual([0, 4])
  })

  it('delete：软删除 UPDATE deleted_at，审计 accounts 快照', async () => {
    mockQuery
      .mockResolvedValueOnce([{ id: 4, role: 0, status: 1, account: 'normal4' }])
      .mockResolvedValueOnce({ affectedRows: 1 })
    const res = await userBatchHandler(
      makeEvent({ user: USER_ADMIN, body: { action: 'delete', ids: [4] } }),
    )
    expect(res.code).toBe(200)
    const updateSql = mockQuery.mock.calls[1]![0] as string
    expect(updateSql).toContain('SET deleted_at = NOW()')
    expect(mockLogAdminOperation).toHaveBeenCalledWith(
      1,
      'user.batchDelete',
      'user',
      0,
      expect.objectContaining({ accounts: ['normal4'] }),
    )
  })
})

// ============ 单条端点回归：容量检查 + 进行中删除护栏 ============

describe('单条 reprocess - 队列深度防御回归', () => {
  it('队列已满返回 400，不触发原子锁', async () => {
    mockIsUploadQueueFull.mockResolvedValue(true)
    const res = await reprocessHandler(
      makeEvent({ user: ADMIN, params: { id: '1' }, body: { unitId: 0 } }),
    )
    expect(res.code).toBe(400)
    expect(mockReprocessRecord).not.toHaveBeenCalled()
  })

  it('队列未满走 reprocessRecord，失败原样返回 code', async () => {
    mockReprocessRecord.mockResolvedValue({ ok: false, reason: '记录不存在', code: 404 })
    const res = await reprocessHandler(
      makeEvent({ user: ADMIN, params: { id: '9' }, body: { unitId: 0 } }),
    )
    expect(res.code).toBe(404)
  })
})

describe('单条记录删除 - 进行中护栏回归', () => {
  it('queued/processing 状态返回 400，不进入事务', async () => {
    mockQuery.mockResolvedValueOnce([{ segment_id: null, title: 't', status: 'processing' }])
    const res = await recordDeleteHandler(makeEvent({ user: ADMIN, params: { id: '1' } }))
    expect(res.code).toBe(400)
    expect(mockWithTransaction).not.toHaveBeenCalled()
  })

  it('终态记录正常删除', async () => {
    mockQuery.mockResolvedValueOnce([{ segment_id: 5, title: 't', status: 'failed' }])
    const res = await recordDeleteHandler(makeEvent({ user: ADMIN, params: { id: '1' } }))
    expect(res.code).toBe(200)
    expect(mockWithTransaction).toHaveBeenCalledTimes(1)
  })
})
