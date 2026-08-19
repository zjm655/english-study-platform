/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest'

import {
  getUserPermissions,
  invalidateUserPermissions,
  userHasPermission,
  ensurePermission,
  writeReviewAccessLog,
  auditionUnlock,
} from '../permission'
import {
  PERMISSIONS,
  GRANTABLE_PERMISSIONS,
  DEFAULT_ADMIN_PERMISSIONS,
} from '#shared/utils/permission'
import { ROLE_USER, ROLE_ADMIN, ROLE_SUPER_ADMIN } from '#shared/utils/role'

// 单元测试：细粒度权限运行时（缓存 / 守卫 / 审计留痕 / 门禁解锁）。
// permission.ts 顶层引入 db.ts 与 oss.ts（均在模块加载时读 useRuntimeConfig），
// h3 提供 readBody/getRequestIP —— node 测试环境统一 mock，避免崩溃并可断言调用。

const { mockQuery, mockSignUrl, mockReadBody } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockSignUrl: vi.fn(),
  mockReadBody: vi.fn(),
}))

// P4 跨实例失效：mock 掉 pubsub（含真实 redis 包），验证 invalidate 广播事件
const { mockPublish, mockSubscribe } = vi.hoisted(() => ({
  mockPublish: vi.fn().mockResolvedValue(undefined),
  mockSubscribe: vi.fn(),
}))

vi.mock('#server/utils/db', () => ({ query: mockQuery }))
vi.mock('#server/utils/oss', () => ({ signUrl: mockSignUrl, MATERIAL_EXPIRE: 2100 }))
vi.mock('#server/utils/redis/pubsub', () => ({
  publish: mockPublish,
  subscribe: mockSubscribe,
  buildChannel: (n: string) => `ep:test:${n}`,
}))
vi.mock('h3', () => ({
  readBody: mockReadBody,
  getRequestIP: () => '10.0.0.1',
}))

beforeEach(() => {
  vi.clearAllMocks()
})

// ============ userHasPermission：超管短路 / 命中 / 未命中 ============

describe('userHasPermission', () => {
  it('超管隐式全权：即便无 permissions 数组也持有任意权限（含 grant_permissions）', () => {
    const su = { id: 1, role: ROLE_SUPER_ADMIN }
    expect(userHasPermission(su, PERMISSIONS.GRANT_PERMISSIONS)).toBe(true)
    expect(userHasPermission(su, PERMISSIONS.REVIEW)).toBe(true)
  })

  it('管理员命中已授予的权限键 → true', () => {
    const admin = { id: 2, role: ROLE_ADMIN, permissions: [PERMISSIONS.MANAGE_USERS] }
    expect(userHasPermission(admin, PERMISSIONS.MANAGE_USERS)).toBe(true)
  })

  it('管理员未被授予的权限键 → false（review 不随默认下放）', () => {
    const admin = { id: 2, role: ROLE_ADMIN, permissions: [PERMISSIONS.MANAGE_USERS] }
    expect(userHasPermission(admin, PERMISSIONS.REVIEW)).toBe(false)
  })

  it('普通用户 / 空用户 → false', () => {
    expect(
      userHasPermission({ id: 3, role: ROLE_USER, permissions: [] }, PERMISSIONS.VIEW_STATS),
    ).toBe(false)
    expect(userHasPermission(null, PERMISSIONS.VIEW_STATS)).toBe(false)
    expect(userHasPermission(undefined, PERMISSIONS.VIEW_STATS)).toBe(false)
  })
})

// ============ getUserPermissions：缓存命中 / 失效 / TTL 过期 ============

describe('getUserPermissions - 每用户 60s 缓存', () => {
  it('首次查库，TTL 内二次调用命中缓存零查询', async () => {
    invalidateUserPermissions(1001)
    mockQuery.mockResolvedValue([{ permission_key: PERMISSIONS.REVIEW }])
    const p1 = await getUserPermissions(1001)
    expect(p1.has(PERMISSIONS.REVIEW)).toBe(true)
    expect(mockQuery).toHaveBeenCalledTimes(1)
    await getUserPermissions(1001)
    expect(mockQuery).toHaveBeenCalledTimes(1) // 命中缓存，无新查询
  })

  it('invalidateUserPermissions 后强制重新查库', async () => {
    invalidateUserPermissions(1002)
    mockQuery.mockResolvedValue([{ permission_key: PERMISSIONS.CONFIG }])
    await getUserPermissions(1002)
    expect(mockQuery).toHaveBeenCalledTimes(1)
    invalidateUserPermissions(1002)
    await getUserPermissions(1002)
    expect(mockQuery).toHaveBeenCalledTimes(2)
  })

  it('P4 跨实例失效：invalidate 时向 perm-invalidate 通道广播失效事件', async () => {
    invalidateUserPermissions(1002)
    // publish 为 fire-and-forget（异步），立即断言已触发
    expect(mockPublish).toHaveBeenCalledTimes(1)
    expect(mockPublish.mock.calls[0]?.[0]).toBe('ep:test:perm-invalidate')
    expect(mockPublish.mock.calls[0]?.[1]).toEqual({ userId: 1002 })
  })

  it('TTL（60s）过期后重新查库', async () => {
    vi.useFakeTimers()
    invalidateUserPermissions(1003)
    mockQuery.mockResolvedValue([{ permission_key: PERMISSIONS.REVIEW }])
    await getUserPermissions(1003)
    expect(mockQuery).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(61_000)
    await getUserPermissions(1003)
    expect(mockQuery).toHaveBeenCalledTimes(2)
    vi.useRealTimers()
  })
})

// ============ ensurePermission：403 / null ============

describe('ensurePermission', () => {
  it('具备权限 → 返回 null（放行）', () => {
    const event = {
      context: { user: { role: ROLE_ADMIN, permissions: [PERMISSIONS.VIEW_STATS] } },
    } as any
    expect(ensurePermission(event, PERMISSIONS.VIEW_STATS)).toBeNull()
  })

  it('缺少权限 → 403', () => {
    const event = { context: { user: { role: ROLE_ADMIN, permissions: [] } } } as any
    expect(ensurePermission(event, PERMISSIONS.REVIEW)?.code).toBe(403)
  })

  it('超管 → 任意权限均放行', () => {
    const event = { context: { user: { role: ROLE_SUPER_ADMIN } } } as any
    expect(ensurePermission(event, PERMISSIONS.GRANT_PERMISSIONS)).toBeNull()
  })

  it('无 user（未登录，理论上被中间件前置拦截）→ 403', () => {
    expect(ensurePermission({ context: {} } as any, PERMISSIONS.VIEW_STATS)?.code).toBe(403)
  })
})

// ============ writeReviewAccessLog：同步 INSERT，失败抛出 ============

describe('writeReviewAccessLog', () => {
  const input = {
    operatorId: 1,
    operatorRole: ROLE_SUPER_ADMIN,
    targetType: 'segment',
    targetId: 5,
    targetUserId: 9,
    reasonCategory: '质量抽查',
    reason: '内容核实',
    ip: '1.1.1.1',
  }

  it('正常写入 review_access_log 表', async () => {
    mockQuery.mockResolvedValueOnce({ insertId: 1 })
    await writeReviewAccessLog(input)
    expect(mockQuery).toHaveBeenCalledTimes(1)
    const [sql, params] = mockQuery.mock.calls[0]!
    expect(sql).toContain('INSERT INTO review_access_log')
    expect(params).toContain('segment')
    expect(params).toContain('内容核实')
  })

  it('写入失败时抛出（供端点捕获后拒签，不静默吞错）', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'))
    await expect(writeReviewAccessLog(input)).rejects.toThrow()
  })
})

// ============ auditionUnlock：校验→留痕→签名（安全顺序） ============

describe('auditionUnlock - 门禁解锁「校验→留痕→签名」', () => {
  const event = { context: { user: { id: 1, role: ROLE_SUPER_ADMIN } } } as any
  const base = {
    targetType: 'segment' as const,
    targetId: 5,
    mediaKey: 'obj/key.mp3',
    targetUserId: 9,
    duration: 12,
  }

  it('理由类别不在白名单 → 400，且不留痕、不签名', async () => {
    mockReadBody.mockResolvedValue({ reasonCategory: '随便填', reason: 'x' })
    const res = await auditionUnlock(event, base)
    expect(res.code).toBe(400)
    expect(mockQuery).not.toHaveBeenCalled()
    expect(mockSignUrl).not.toHaveBeenCalled()
  })

  it('reason 为空 → 400，且不签名', async () => {
    mockReadBody.mockResolvedValue({ reasonCategory: '质量抽查', reason: '   ' })
    const res = await auditionUnlock(event, base)
    expect(res.code).toBe(400)
    expect(mockSignUrl).not.toHaveBeenCalled()
  })

  it('reason 超过 500 字 → 400', async () => {
    mockReadBody.mockResolvedValue({ reasonCategory: '质量抽查', reason: 'a'.repeat(501) })
    const res = await auditionUnlock(event, base)
    expect(res.code).toBe(400)
    expect(mockSignUrl).not.toHaveBeenCalled()
  })

  it('无音频 object_key → 404', async () => {
    mockReadBody.mockResolvedValue({ reasonCategory: '质量抽查', reason: '核实内容' })
    const res = await auditionUnlock(event, { ...base, mediaKey: null })
    expect(res.code).toBe(404)
    expect(mockSignUrl).not.toHaveBeenCalled()
  })

  it('留痕成功后才签名，返回 audioUrl + duration', async () => {
    mockReadBody.mockResolvedValue({ reasonCategory: '质量抽查', reason: '核实内容' })
    mockQuery.mockResolvedValueOnce({ insertId: 1 })
    mockSignUrl.mockResolvedValueOnce('https://signed-url')
    const res = await auditionUnlock(event, base)
    expect(res.code).toBe(200)
    expect(res.data!.audioUrl).toBe('https://signed-url')
    expect(res.data!.duration).toBe(12)
    // 留痕（query）先于签名（signUrl）发生
    expect(mockQuery).toHaveBeenCalledTimes(1)
    expect(mockSignUrl).toHaveBeenCalledTimes(1)
  })

  it('留痕失败 → 抛出且绝不签名（安全优先）', async () => {
    mockReadBody.mockResolvedValue({ reasonCategory: '质量抽查', reason: '核实内容' })
    mockQuery.mockRejectedValueOnce(new Error('insert failed'))
    await expect(auditionUnlock(event, base)).rejects.toThrow()
    expect(mockSignUrl).not.toHaveBeenCalled()
  })
})

// ============ ops_backup 运维备份权限（P4 后续 spec 任务 3） ============

describe('ops_backup 运维备份权限', () => {
  it('权限键存在且值为 ops_backup', () => {
    expect(PERMISSIONS.OPS_BACKUP).toBe('ops_backup')
  })

  it('可被授权：grant_permissions 之外均可授予（GRANTABLE_PERMISSIONS 含 ops_backup）', () => {
    expect(GRANTABLE_PERMISSIONS).toContain(PERMISSIONS.OPS_BACKUP)
  })

  it('不随存量管理员默认权限下放（仅超管显式授予）', () => {
    expect(DEFAULT_ADMIN_PERMISSIONS).not.toContain(PERMISSIONS.OPS_BACKUP)
  })
})
