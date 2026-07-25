/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest'

import listHandler from '../review-access.get'
import exportHandler from '../export.get'
import { PERMISSIONS } from '#shared/utils/permission'

// handler 级集成测试：审核留痕列表的 view_audit 门禁（VIEW_LOGS 持有者不可见）、
// 筛选参数校验与 SQL 拼装；导出白名单按表映射权限（防 VIEW_LOGS 绕道导出审计数据）。

vi.hoisted(() => {
  // Nuxt 自动导入的符号在 vitest node 环境需手动挂全局
  ;(globalThis as any).defineEventHandler = (handler: any) => handler
  ;(globalThis as any).getQuery = (event: any) => event.__query ?? {}
  ;(globalThis as any).setHeader = () => {}
  ;(globalThis as any).logger = { error: () => {}, warn: () => {}, info: () => {} }
})

const { mockQuery } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
}))

vi.mock('#server/utils/db', () => ({
  query: mockQuery,
  withTransaction: vi.fn(),
}))
// permission.ts 透传引入 oss.ts（其模块顶层读 useRuntimeConfig），node 测试环境需 mock 避免崩溃
vi.mock('#server/utils/oss', () => ({ signUrl: vi.fn(), MATERIAL_EXPIRE: 2100 }))

// ============ 辅助 ============

/** 仅持日志查看（被监督者常见画像）：不得访问审核留痕 */
const LOG_ADMIN = { id: 2, role: 1, permissions: [PERMISSIONS.VIEW_LOGS] }
/** 持审计查看：合规岗画像 */
const AUDIT_ADMIN = { id: 3, role: 1, permissions: [PERMISSIONS.VIEW_AUDIT] }
/** 超管：隐式全权 */
const SUPER_ADMIN = { id: 1, role: 2, permissions: [] }

function makeEvent(opts: { user?: unknown; query?: Record<string, string> } = {}) {
  return {
    context: { user: opts.user },
    __query: opts.query,
  } as any
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ============ 列表：view_audit 门禁 ============

describe('审核留痕列表 - 权限', () => {
  it('持 VIEW_LOGS（无 view_audit）返回 403，不触碰数据库', async () => {
    const res = await listHandler(makeEvent({ user: LOG_ADMIN }))
    expect(res.code).toBe(403)
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('未登录返回 403', async () => {
    expect((await listHandler(makeEvent({}))).code).toBe(403)
  })

  it('超管隐式全权放行', async () => {
    mockQuery.mockResolvedValueOnce([]).mockResolvedValueOnce([{ total: 0 }])
    const res = await listHandler(makeEvent({ user: SUPER_ADMIN }))
    expect(res.code).toBe(200)
  })

  it('持 view_audit 放行', async () => {
    mockQuery.mockResolvedValueOnce([]).mockResolvedValueOnce([{ total: 0 }])
    const res = await listHandler(makeEvent({ user: AUDIT_ADMIN }))
    expect(res.code).toBe(200)
  })
})

// ============ 列表：参数校验与 SQL 拼装 ============

describe('审核留痕列表 - 筛选', () => {
  it('targetType 非法值返回 400', async () => {
    const res = await listHandler(
      makeEvent({ user: AUDIT_ADMIN, query: { targetType: 'not_exist' } }),
    )
    expect(res.code).toBe(400)
  })

  it('reasonCategory 不在白名单返回 400', async () => {
    const res = await listHandler(
      makeEvent({ user: AUDIT_ADMIN, query: { reasonCategory: '随便写的' } }),
    )
    expect(res.code).toBe(400)
  })

  it('合法筛选：等值条件 + 日期区间（endDate+1 天）+ 双 LEFT JOIN', async () => {
    mockQuery.mockResolvedValueOnce([]).mockResolvedValueOnce([{ total: 0 }])
    const res = await listHandler(
      makeEvent({
        user: AUDIT_ADMIN,
        query: {
          page: '2',
          pageSize: '10',
          targetType: 'recording',
          reasonCategory: '质量抽查',
          keyword: 'acc',
          startDate: '2026-07-01',
          endDate: '2026-07-20',
        },
      }),
    )
    expect(res.code).toBe(200)

    const [sql, params] = mockQuery.mock.calls[0]!
    expect(sql).toContain('FROM review_access_log ral')
    expect(sql).toContain('LEFT JOIN user u ON ral.operator_id = u.id')
    expect(sql).toContain('LEFT JOIN user tu ON ral.target_user_id = tu.id')
    expect(sql).toContain('ral.target_type = ?')
    expect(sql).toContain('ral.reason_category = ?')
    expect(sql).toContain('u.account LIKE ?')
    expect(sql).toContain('ORDER BY ral.id DESC')
    // 参数：targetType, reasonCategory, keyword, start, end(+1天), pageSize, offset
    expect(params).toEqual([
      'recording',
      '质量抽查',
      '%acc%',
      '2026-07-01 00:00:00',
      '2026-07-21 00:00:00',
      10,
      10,
    ])
  })
})

// ============ 导出：白名单按表映射权限 ============

describe('日志导出 - review_access_log 权限映射', () => {
  it('持 VIEW_LOGS 导出 review_access_log 被拒（403）', async () => {
    const res: any = await exportHandler(
      makeEvent({ user: LOG_ADMIN, query: { table: 'review_access_log' } }),
    )
    expect(res.code).toBe(403)
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('持 view_audit 导出 review_access_log 放行（返回 CSV）', async () => {
    mockQuery.mockResolvedValueOnce([{ id: 1, reason: '测试' }])
    const res: any = await exportHandler(
      makeEvent({ user: AUDIT_ADMIN, query: { table: 'review_access_log' } }),
    )
    expect(typeof res).toBe('string')
    expect(res).toContain('id')
  })

  it('持 VIEW_LOGS 导出常规日志表行为不变（放行）', async () => {
    mockQuery.mockResolvedValueOnce([{ id: 1, path: '/api/x' }])
    const res: any = await exportHandler(
      makeEvent({ user: LOG_ADMIN, query: { table: 'api_call_log' } }),
    )
    expect(typeof res).toBe('string')
  })

  it('持 view_audit（无 VIEW_LOGS）导出常规日志表被拒', async () => {
    const res: any = await exportHandler(
      makeEvent({ user: AUDIT_ADMIN, query: { table: 'admin_operation_log' } }),
    )
    expect(res.code).toBe(403)
  })

  it('白名单外表名返回 400', async () => {
    const res: any = await exportHandler(
      makeEvent({ user: SUPER_ADMIN, query: { table: 'user' } }),
    )
    expect(res.code).toBe(400)
  })
})
