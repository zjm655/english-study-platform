import { describe, it, expect, vi, beforeEach } from 'vitest'

import {
  getActiveNotices,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  getNoticeDetailForUser,
  getNoticesForAdmin,
  createNotice,
  updateNotice,
  deleteNotice,
} from '../notice'

// 单元测试：公告业务层（活跃口径过滤 / 已读回执 / 管理端状态机 / 操作留痕）。
// notice.ts 依赖 #server/utils/db（顶层读 useRuntimeConfig）与 #server/services/adminLog，
// node 测试环境统一 mock，既避免崩溃又可断言调用参数。

const { mockQuery, mockLogAdminOperation } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockLogAdminOperation: vi.fn(),
}))

vi.mock('#server/utils/db', () => ({ query: mockQuery }))
vi.mock('#server/services/adminLog', () => ({ logAdminOperation: mockLogAdminOperation }))

beforeEach(() => {
  vi.clearAllMocks()
})

// ============ 活跃口径：草稿/未到时/已过期/已撤回/软删均不可见 ============

describe('活跃公告统一口径', () => {
  it('列表 SQL 含 published + 未软删 + 已到发布时刻 + 未过期 四条件', async () => {
    mockQuery.mockResolvedValueOnce([]).mockResolvedValueOnce([{ total: 0 }])
    await getActiveNotices(1, 1, 10)
    const sql = mockQuery.mock.calls[0]![0] as string
    expect(sql).toContain("status = 'published'") // 排除 draft/revoked
    expect(sql).toContain('deleted_at IS NULL') // 排除软删
    expect(sql).toContain('publish_at <= NOW()') // 排除未到发布时刻
    expect(sql).toContain('expire_at IS NULL OR n.expire_at > NOW()') // 排除已过期
  })

  it('列表 isRead/isPinned 转布尔，分页 offset 与参数正确', async () => {
    mockQuery
      .mockResolvedValueOnce([
        {
          id: 1,
          title: 't',
          content: 'c',
          status: 'published',
          publishAt: '2026-01-01 00:00:00',
          expireAt: null,
          isPinned: 1,
          createdAt: '2026-01-01 00:00:00',
          isRead: 0,
        },
      ])
      .mockResolvedValueOnce([{ total: 5 }])
    const res = await getActiveNotices(9, 2, 10)
    expect(res.list[0]!.isPinned).toBe(true)
    expect(res.list[0]!.isRead).toBe(false)
    expect(res.total).toBe(5)
    // params: [userId, pageSize, offset]，offset=(2-1)*10=10
    expect(mockQuery.mock.calls[0]![1]).toEqual([9, 10, 10])
  })
})

// ============ 未读计数 ============

describe('getUnreadCount', () => {
  it('用 NOT EXISTS 对活跃公告计数', async () => {
    mockQuery.mockResolvedValueOnce([{ cnt: 3 }])
    const n = await getUnreadCount(7)
    expect(n).toBe(3)
    const sql = mockQuery.mock.calls[0]![0] as string
    expect(sql).toContain('NOT EXISTS')
    expect(sql).toContain("status = 'published'")
  })
})

// ============ 已读回执：INSERT IGNORE 幂等 ============

describe('markAsRead / markAllAsRead', () => {
  it('markAsRead 使用 INSERT IGNORE 保证幂等', async () => {
    mockQuery.mockResolvedValueOnce({ affectedRows: 1 })
    await markAsRead(1, 2)
    const [sql, params] = mockQuery.mock.calls[0]!
    expect(sql).toContain('INSERT IGNORE INTO notice_read')
    expect(params).toEqual([1, 2])
  })

  it('markAllAsRead 用 INSERT IGNORE ... SELECT 活跃公告，返回 affectedRows', async () => {
    mockQuery.mockResolvedValueOnce({ affectedRows: 4 })
    const n = await markAllAsRead(5)
    expect(n).toBe(4)
    const sql = mockQuery.mock.calls[0]![0] as string
    expect(sql).toContain('INSERT IGNORE INTO notice_read')
    expect(sql).toContain("status = 'published'")
  })
})

// ============ 用户端详情：活跃校验 + fire-and-forget 标已读 ============

describe('getNoticeDetailForUser', () => {
  it('非活跃公告返回 null 且不标已读（仅一次查询）', async () => {
    mockQuery.mockResolvedValueOnce([])
    const res = await getNoticeDetailForUser(1, 99)
    expect(res).toBeNull()
    expect(mockQuery).toHaveBeenCalledTimes(1)
  })

  it('活跃公告返回详情并触发标已读', async () => {
    mockQuery
      .mockResolvedValueOnce([
        {
          id: 3,
          title: 't',
          content: 'c',
          status: 'published',
          publishAt: '2026-01-01 00:00:00',
          expireAt: null,
          isPinned: 0,
          createdAt: '2026-01-01 00:00:00',
        },
      ])
      .mockResolvedValueOnce({ affectedRows: 1 }) // fire-and-forget markAsRead
    const res = await getNoticeDetailForUser(1, 3)
    expect(res?.id).toBe(3)
    expect(res?.isPinned).toBe(false)
    // 详情查询 + 标已读 INSERT IGNORE 各一次
    expect(mockQuery).toHaveBeenCalledTimes(2)
    expect(mockQuery.mock.calls[1]![0] as string).toContain('INSERT IGNORE INTO notice_read')
  })
})

// ============ 管理端列表：全状态 + createdByName + readCount ============

describe('getNoticesForAdmin', () => {
  it('status=all 不加状态过滤，含创建者昵称与阅读数聚合', async () => {
    mockQuery.mockResolvedValueOnce([]).mockResolvedValueOnce([{ total: 0 }])
    await getNoticesForAdmin(undefined, 'all', 1, 10)
    const sql = mockQuery.mock.calls[0]![0] as string
    expect(sql).not.toContain('n.status = ?')
    expect(sql).toContain('createdByName')
    expect(sql).toContain('COUNT(nr.id)')
    expect(sql).toContain('GROUP BY n.id')
  })

  it('status/keyword 生成过滤条件与参数', async () => {
    mockQuery.mockResolvedValueOnce([]).mockResolvedValueOnce([{ total: 0 }])
    await getNoticesForAdmin('公告', 'draft', 1, 10)
    const [sql, params] = mockQuery.mock.calls[0]!
    expect(sql).toContain('n.status = ?')
    expect(sql).toContain('n.title LIKE ?')
    expect(params).toContain('draft')
    expect(params).toContain('%公告%')
  })
})

// ============ 创建：status 与 publishAt 处理 + 操作留痕 ============

describe('createNotice', () => {
  it('未传 publishAt 用 NOW()，记 notice.create 日志', async () => {
    mockQuery.mockResolvedValueOnce({ insertId: 42 })
    const id = await createNotice(10, {
      title: 't',
      content: 'c',
      status: 'published',
      isPinned: false,
    })
    expect(id).toBe(42)
    expect(mockQuery.mock.calls[0]![0] as string).toContain('NOW()')
    expect(mockLogAdminOperation).toHaveBeenCalledWith(
      10,
      'notice.create',
      'notice',
      42,
      expect.any(Object),
    )
  })

  it('传 publishAt 时用占位符参数（不落 NOW()）', async () => {
    mockQuery.mockResolvedValueOnce({ insertId: 1 })
    await createNotice(10, {
      title: 't',
      content: 'c',
      status: 'draft',
      publishAt: '2026-08-01 10:00:00',
      isPinned: true,
    })
    const [sql, params] = mockQuery.mock.calls[0]!
    expect(sql).not.toContain('NOW()')
    expect(params).toContain('2026-08-01 10:00:00')
  })
})

// ============ 更新：状态转移校验 ============

describe('updateNotice 状态转移', () => {
  it('公告不存在返回 404', async () => {
    mockQuery.mockResolvedValueOnce([])
    const res = await updateNotice(1, 999, { isPinned: true })
    expect(res?.code).toBe(404)
  })

  it('软删公告返回 404', async () => {
    mockQuery.mockResolvedValueOnce([{ id: 1, status: 'draft', deleted_at: '2026-01-01 00:00:00' }])
    const res = await updateNotice(1, 1, { isPinned: true })
    expect(res?.code).toBe(404)
  })

  it('已撤回公告不可编辑（400，不执行 UPDATE）', async () => {
    mockQuery.mockResolvedValueOnce([{ id: 1, status: 'revoked', deleted_at: null }])
    const res = await updateNotice(1, 1, { isPinned: true })
    expect(res?.code).toBe(400)
    expect(mockQuery).toHaveBeenCalledTimes(1)
    expect(mockLogAdminOperation).not.toHaveBeenCalled()
  })

  it('已发布公告改 title 被拒（400，不执行 UPDATE）', async () => {
    mockQuery.mockResolvedValueOnce([{ id: 1, status: 'published', deleted_at: null }])
    const res = await updateNotice(1, 1, { title: '新标题' })
    expect(res?.code).toBe(400)
    expect(mockQuery).toHaveBeenCalledTimes(1)
    expect(mockLogAdminOperation).not.toHaveBeenCalled()
  })

  it('已发布公告改 expire_at / is_pinned 允许', async () => {
    mockQuery
      .mockResolvedValueOnce([{ id: 1, status: 'published', deleted_at: null }])
      .mockResolvedValueOnce({ affectedRows: 1 })
    const res = await updateNotice(1, 1, { isPinned: true, expireAt: '2027-01-01 00:00:00' })
    expect(res).toBeNull()
    expect(mockLogAdminOperation).toHaveBeenCalledWith(
      1,
      'notice.update',
      'notice',
      1,
      expect.any(Object),
    )
  })

  it('已发布公告转 revoked 允许并记 notice.revoke', async () => {
    mockQuery
      .mockResolvedValueOnce([{ id: 1, status: 'published', deleted_at: null }])
      .mockResolvedValueOnce({ affectedRows: 1 })
    const res = await updateNotice(2, 1, { status: 'revoked' })
    expect(res).toBeNull()
    expect(mockLogAdminOperation).toHaveBeenCalledWith(
      2,
      'notice.revoke',
      'notice',
      1,
      expect.any(Object),
    )
  })

  it('草稿可改全部字段并记 notice.update', async () => {
    mockQuery
      .mockResolvedValueOnce([{ id: 1, status: 'draft', deleted_at: null }])
      .mockResolvedValueOnce({ affectedRows: 1 })
    const res = await updateNotice(3, 1, {
      title: 't',
      content: 'c',
      status: 'published',
      isPinned: true,
    })
    expect(res).toBeNull()
    const sql = mockQuery.mock.calls[1]![0] as string
    expect(sql).toContain('UPDATE notice SET')
    expect(sql).toContain('title = ?')
    expect(mockLogAdminOperation).toHaveBeenCalledWith(
      3,
      'notice.update',
      'notice',
      1,
      expect.any(Object),
    )
  })
})

// ============ 删除：软删 + 留痕 ============

describe('deleteNotice', () => {
  it('软删成功置 deleted_at 并记 notice.delete', async () => {
    mockQuery.mockResolvedValueOnce({ affectedRows: 1 })
    const res = await deleteNotice(4, 1)
    expect(res).toBeNull()
    expect(mockQuery.mock.calls[0]![0] as string).toContain('deleted_at = NOW()')
    expect(mockLogAdminOperation).toHaveBeenCalledWith(4, 'notice.delete', 'notice', 1)
  })

  it('affectedRows=0（不存在/已删）返回 404 且不记日志', async () => {
    mockQuery.mockResolvedValueOnce({ affectedRows: 0 })
    const res = await deleteNotice(4, 999)
    expect(res?.code).toBe(404)
    expect(mockLogAdminOperation).not.toHaveBeenCalled()
  })
})
