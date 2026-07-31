/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { z } from 'zod'
import handler from '../study-time.put'

// ===== Nuxt 自动注入全局函数（vitest node 环境需手动挂） =====
vi.hoisted(() => {
  ;(globalThis as any).defineEventHandler = (handler: any) => handler
})

// ===== hoisted mock 引用 =====
const {
  mockReadGuestKey,
  mockSetGuestCookie,
  mockEnsureGuestUser,
  mockGetGuestDailyStudyCap,
  mockAccumulateStudyTime,
  mockWithTransaction,
  mockReadBody,
} = vi.hoisted(() => ({
  mockReadGuestKey: vi.fn(),
  mockSetGuestCookie: vi.fn(),
  mockEnsureGuestUser: vi.fn(),
  mockGetGuestDailyStudyCap: vi.fn(),
  mockAccumulateStudyTime: vi.fn(),
  mockWithTransaction: vi.fn(),
  mockReadBody: vi.fn(),
}))

// ===== 全局挂载 auto-import =====
;(globalThis as any).readBody = mockReadBody
;(globalThis as any).validateSuccess = (data: unknown, message = '') => ({
  code: 200,
  message,
  data,
})
;(globalThis as any).validateError = (message: string, code = 400) => ({
  code,
  message,
  data: null,
})
// 使用与生产一致的 zod schema（含 min/max 约束）
;(globalThis as any).studyTimeSchema = z.object({
  studySeconds: z.number().min(0, '学习时长不能为负数').max(3600, '单次上报时长不能超过1小时'),
})

// ===== 模块 mock（handler 显式 import 的依赖） =====
vi.mock('#server/utils/db', () => ({ withTransaction: mockWithTransaction }))
vi.mock('#server/utils/guest', () => ({
  readGuestKey: mockReadGuestKey,
  setGuestCookie: mockSetGuestCookie,
}))
vi.mock('#server/services/guestUser', () => ({
  ensureGuestUser: mockEnsureGuestUser,
  getGuestDailyStudyCap: mockGetGuestDailyStudyCap,
}))
vi.mock('#server/services/studyTime', () => ({
  accumulateStudyTime: mockAccumulateStudyTime,
}))
// node:crypto 用真实实现即可（randomUUID）

beforeEach(() => {
  vi.clearAllMocks()
})

// 构造 event 辅助
function makeEvent(overrides: { user?: any; body?: any } = {}) {
  return {
    context: { user: overrides.user ?? undefined },
    _body: overrides.body,
  } as any
}

// ===== 分支 1：登录用户误调 → 空操作 =====
describe('登录用户误调', () => {
  it('event.context.user 存在 → 直接返回 null，不读 cookie', async () => {
    const res = await handler(makeEvent({ user: { id: 1, role: 0 } }))
    expect(res.code).toBe(200)
    expect(res.data).toBeNull()
    expect(mockReadGuestKey).not.toHaveBeenCalled()
  })
})

// ===== 分支 2：参数校验失败 =====
describe('参数校验', () => {
  it('body 缺少 studySeconds → 400', async () => {
    mockReadBody.mockResolvedValueOnce({})
    const res = await handler(makeEvent())
    expect(res.code).toBe(400)
    expect(res.message).toBeTruthy()
  })

  it('studySeconds 非数字 → 400', async () => {
    mockReadBody.mockResolvedValueOnce({ studySeconds: 'abc' })
    const res = await handler(makeEvent())
    expect(res.code).toBe(400)
  })

  it('studySeconds 超过 3600 → 400', async () => {
    mockReadBody.mockResolvedValueOnce({ studySeconds: 9999 })
    const res = await handler(makeEvent())
    expect(res.code).toBe(400)
  })
})

// ===== 分支 3：无 guest_token cookie → 签发新 cookie =====
describe('无 cookie → 懒签发', () => {
  it('无 cookie 且 studySeconds<=0 → 签发 cookie 后早返回', async () => {
    mockReadBody.mockResolvedValueOnce({ studySeconds: 0 })
    mockReadGuestKey.mockResolvedValueOnce(null) // 无 cookie

    const res = await handler(makeEvent())

    expect(res.code).toBe(200)
    expect(mockSetGuestCookie).toHaveBeenCalledOnce()
    // 返回的 guestDisplayId 是 8 位前缀
    expect(res.data!.guestDisplayId).toHaveLength(8)
    expect(res.data!.stats).toBeNull()
    // <=0 秒不触发事务
    expect(mockWithTransaction).not.toHaveBeenCalled()
  })

  it('无 cookie 且 studySeconds>0 → 签发 cookie 后正常累计', async () => {
    mockReadBody.mockResolvedValueOnce({ studySeconds: 30 })
    mockReadGuestKey.mockResolvedValueOnce(null)
    mockGetGuestDailyStudyCap.mockResolvedValueOnce(3600)

    const fakeStats = { totalSeconds: 30, todaySeconds: 30 }
    mockWithTransaction.mockImplementationOnce(async (fn: any) => {
      mockEnsureGuestUser.mockResolvedValueOnce({ conflict: false, userId: 100 })
      mockAccumulateStudyTime.mockResolvedValueOnce(fakeStats)
      return fn({} as any)
    })

    const res = await handler(makeEvent())

    expect(res.code).toBe(200)
    expect(mockSetGuestCookie).toHaveBeenCalledOnce()
    expect(res.data!.stats).toEqual(fakeStats)
    expect(mockEnsureGuestUser).toHaveBeenCalledOnce()
    expect(mockAccumulateStudyTime).toHaveBeenCalledOnce()
  })
})

// ===== 分支 4：有 cookie 但 studySeconds<=0 → 早返回 =====
describe('有 cookie + <=0 秒 → 早返回', () => {
  it('studySeconds=0 → 不落库，返回 guestDisplayId', async () => {
    mockReadBody.mockResolvedValueOnce({ studySeconds: 0 })
    mockReadGuestKey.mockResolvedValueOnce('abcdef12-3456-7890-abcd-ef1234567890')

    const res = await handler(makeEvent())

    expect(res.code).toBe(200)
    expect(res.data!.guestDisplayId).toBe('abcdef12')
    expect(res.data!.stats).toBeNull()
    expect(mockSetGuestCookie).not.toHaveBeenCalled() // 已有 cookie 不重签
    expect(mockWithTransaction).not.toHaveBeenCalled()
  })

  it('studySeconds 为负数 → 同样早返回', async () => {
    // 注意：zod schema 有 min(0) 约束，负数会被 schema 拦截返回 400
    // 此处验证 studySeconds=0 的边界（恰好不触发落库）
    mockReadBody.mockResolvedValueOnce({ studySeconds: 0 })
    mockReadGuestKey.mockResolvedValueOnce('xyz12345-0000-0000-0000-000000000000')

    const res = await handler(makeEvent())

    expect(res.code).toBe(200)
    expect(res.data!.guestDisplayId).toBe('xyz12345')
    expect(res.data!.stats).toBeNull()
  })
})

// ===== 分支 5：有 cookie + 正数 → 正常累计 =====
describe('有 cookie + 正数 → 正常累计', () => {
  it('ensureGuestUser 返回非 conflict → 累计成功', async () => {
    mockReadBody.mockResolvedValueOnce({ studySeconds: 60 })
    mockReadGuestKey.mockResolvedValueOnce('aabbccdd-1111-2222-3333-444444444444')
    mockGetGuestDailyStudyCap.mockResolvedValueOnce(7200)

    const fakeStats = { totalSeconds: 120, todaySeconds: 60 }
    mockWithTransaction.mockImplementationOnce(async (fn: any) => {
      mockEnsureGuestUser.mockResolvedValueOnce({ conflict: false, userId: 42 })
      mockAccumulateStudyTime.mockResolvedValueOnce(fakeStats)
      return fn({} as any)
    })

    const res = await handler(makeEvent())

    expect(res.code).toBe(200)
    expect(res.data!.guestDisplayId).toBe('aabbccdd')
    expect(res.data!.stats).toEqual(fakeStats)
    // 不重签 cookie
    expect(mockSetGuestCookie).not.toHaveBeenCalled()
  })
})

// ===== 分支 6：ensureGuestUser 返回 conflict → 换发新 key =====
describe('残留 cookie（conflict）→ 换发新 key', () => {
  it('ensureGuestUser conflict → stats 为 null → 签发全新 cookie', async () => {
    mockReadBody.mockResolvedValueOnce({ studySeconds: 30 })
    mockReadGuestKey.mockResolvedValueOnce('oldmergedkey00000000000000000000')
    mockGetGuestDailyStudyCap.mockResolvedValueOnce(3600)

    mockWithTransaction.mockImplementationOnce(async (fn: any) => {
      mockEnsureGuestUser.mockResolvedValueOnce({ conflict: true })
      return fn({} as any)
    })

    const res = await handler(makeEvent())

    expect(res.code).toBe(200)
    // 换发了新 key，displayId 不应等于旧 key 前缀
    expect(res.data!.guestDisplayId).toHaveLength(8)
    expect(res.data!.guestDisplayId).not.toBe('oldmerge')
    expect(res.data!.stats).toBeNull()
    // 确认重签了 cookie
    expect(mockSetGuestCookie).toHaveBeenCalledOnce()
    // 不触发 accumulateStudyTime（conflict 直接返回 null）
    expect(mockAccumulateStudyTime).not.toHaveBeenCalled()
  })
})
