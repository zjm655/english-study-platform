/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// vi.mock 由 vitest 提升到模块顶部执行，此处 import 时 mock 已生效
import handler, { maskAccount, buildBoard } from '../[segId]/leaderboard.get'

// ===== segment leaderboard 测试 =====
// 覆盖：账号打码 / 无效或不可见片段护栏 / 榜单映射与 isMe / 昵称回退 / 榜外名次计算 / 封禁销号排除口径

const { mockQuery, mockSignAvatar } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockSignAvatar: vi.fn(async (url: string | null) => (url ? `signed:${url}` : null)),
}))

// 在所有 import 之前设置 Nuxt 自动注入的全局函数
vi.hoisted(() => {
  ;(globalThis as any).defineEventHandler = (handler: any) => handler
  ;(globalThis as any).getRouterParam = (event: any, name: string) => event?.params?.[name]
})

vi.mock('#server/utils/db', () => ({ query: mockQuery }))
vi.mock('#server/utils/oss', () => ({ signAvatarUrl: mockSignAvatar }))
vi.mock('#server/utils/validate', () => ({
  validateError: (message: string, code = 400) => ({ code, message, data: null }),
  validateSuccess: (data: unknown, message = '') => ({ code: 200, message, data }),
}))

beforeEach(() => {
  vi.clearAllMocks()
})

function makeEvent(segId: unknown, user: { id: number; role: number }) {
  return { params: { segId }, context: { user } } as any
}

describe('maskAccount', () => {
  it('长账号保留前2后2', () => {
    expect(maskAccount('12345678')).toBe('12***78')
    expect(maskAccount('abcdefgh')).toBe('ab***gh')
  })

  it('短账号仅保留首字符', () => {
    expect(maskAccount('abc')).toBe('a***')
    expect(maskAccount('abcd')).toBe('a***')
  })
})

describe('handler 护栏', () => {
  it('无效 segId 直接拒绝且不查库', async () => {
    const res = await handler(makeEvent('abc', { id: 1, role: 0 }))
    expect(res.code).toBe(400)
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('片段不存在（或软删）返回 404', async () => {
    mockQuery.mockResolvedValueOnce([])
    const res = await handler(makeEvent('9', { id: 1, role: 0 }))
    expect(res.code).toBe(404)
    expect(res.message).toBe('片段不存在')
  })

  it('私有材料非上传者返回 404（防探测）', async () => {
    mockQuery.mockResolvedValueOnce([
      { id: 9, title: 'S', unit_id: 0, is_public: 0, uploader_id: 99 },
    ])
    const res = await handler(makeEvent('9', { id: 1, role: 0 }))
    expect(res.code).toBe(404)
  })

  it('私有材料上传者本人可访问', async () => {
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM segment s')) {
        return [{ id: 9, title: 'S', unit_id: 3, is_public: 0, uploader_id: 1 }]
      }
      return [] // 两阶段榜单与我的成绩均为空
    })
    const res = await handler(makeEvent('9', { id: 1, role: 0 }))
    expect(res.code).toBe(200)
    expect(res.data!.segment).toEqual({ id: 9, title: 'S', unitId: 3 })
    expect(res.data!.phase3).toEqual({ list: [], me: null })
    expect(res.data!.phase4).toEqual({ list: [], me: null })
  })

  it('管理员可访问他人私有材料', async () => {
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM segment s')) {
        return [{ id: 9, title: 'S', unit_id: 0, is_public: 0, uploader_id: 99 }]
      }
      return []
    })
    const res = await handler(makeEvent('9', { id: 1, role: 1 }))
    expect(res.code).toBe(200)
  })
})

describe('buildBoard', () => {
  it('榜单按序映射 rank/isMe，昵称为空回退打码账号，头像走签名', async () => {
    mockQuery.mockResolvedValueOnce([
      {
        userId: 7,
        bestScore: '95.50',
        achievedAt: new Date('2026-07-01T10:00:00Z'),
        nickname: '小明',
        account: '11112222',
        avatarUrl: 'avatar/7.png',
      },
      {
        userId: 1,
        bestScore: '90.00',
        achievedAt: new Date('2026-07-02T10:00:00Z'),
        nickname: '  ',
        account: '33334444',
        avatarUrl: null,
      },
    ])

    const board = await buildBoard(9, 3, 1)

    expect(board.list).toEqual([
      {
        rank: 1,
        nickname: '小明',
        avatarUrl: 'signed:avatar/7.png',
        bestScore: 95.5,
        achievedAt: '2026-07-01T10:00:00.000Z',
        isMe: false,
      },
      {
        rank: 2,
        nickname: '33***44',
        avatarUrl: null,
        bestScore: 90,
        achievedAt: '2026-07-02T10:00:00.000Z',
        isMe: true,
      },
    ])
    // 我在榜内：me 直接取行，不再发额外查询
    expect(board.me).toEqual({ rank: 2, bestScore: 90, achievedAt: '2026-07-02T10:00:00.000Z' })
    expect(mockQuery).toHaveBeenCalledTimes(1)
    // 榜单排除封禁/销号用户的口径固化在 SQL 中
    const [sql] = mockQuery.mock.calls[0]!
    expect(String(sql)).toContain('u.deleted_at IS NULL AND u.status = 1')
    expect(String(sql)).toContain('ORDER BY bestScore DESC, achievedAt ASC')
  })

  it('榜外用户：单独查最佳分并按「更强人数+1」计算名次', async () => {
    const myAchieved = new Date('2026-07-03T10:00:00Z')
    mockQuery
      .mockResolvedValueOnce([
        {
          userId: 7,
          bestScore: '95.50',
          achievedAt: new Date('2026-07-01T10:00:00Z'),
          nickname: 'A',
          account: '11112222',
          avatarUrl: null,
        },
      ]) // Top 榜（不含我）
      .mockResolvedValueOnce([{ bestScore: '60.00', achievedAt: myAchieved }]) // 我的最佳
      .mockResolvedValueOnce([{ cnt: 57 }]) // 比我强的人数

    const board = await buildBoard(9, 4, 1)

    expect(board.me).toEqual({
      rank: 58,
      bestScore: 60,
      achievedAt: '2026-07-03T10:00:00.000Z',
    })
    expect(mockQuery).toHaveBeenCalledTimes(3)
    const [rankSql, rankParams] = mockQuery.mock.calls[2]!
    expect(String(rankSql)).toContain(
      'HAVING b.best_score > ? OR (b.best_score = ? AND achieved_at < ?)',
    )
    // achievedAt 透传驱动原始 Date（非 ISO 字符串），避免 MySQL 无法解析带 Z 后缀的字面量
    expect(rankParams).toEqual([9, 4, 9, 4, 60, 60, myAchieved])
  })

  it('无任何成绩：me 为 null', async () => {
    mockQuery.mockResolvedValue([])
    const board = await buildBoard(9, 3, 1)
    expect(board.list).toEqual([])
    expect(board.me).toBeNull()
    // Top 榜 + 我的最佳两次查询，无名次计算
    expect(mockQuery).toHaveBeenCalledTimes(2)
  })
})
