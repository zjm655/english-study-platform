import { describe, it, expect, vi, beforeEach } from 'vitest'

import listHandler from '../index.get'
import detailHandler from '../[segId].get'
import putHandler from '../[segId].put'
import deleteHandler from '../[segId].delete'

// handler 级集成测试：覆盖管理员材料 CRUD 的权限门禁（403）、列表查询参数强转、
// 编辑 schema 校验与词汇 diff、软删除 affectedRows=0 → 404。走真实 validate schema。

vi.hoisted(() => {
  // Nuxt 自动导入的符号在 vitest node 环境需手动挂全局
  ;(globalThis as any).defineEventHandler = (handler: any) => handler
  ;(globalThis as any).getQuery = (event: any) => event.__query ?? {}
  ;(globalThis as any).getRouterParam = (event: any, name: string) => event.__params?.[name]
  ;(globalThis as any).logger = { error: () => {}, warn: () => {}, info: () => {} }
})

const { mockQuery, mockWithTransaction, mockConnExecute, mockReadBody } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockWithTransaction: vi.fn(),
  mockConnExecute: vi.fn(),
  mockReadBody: vi.fn(),
}))

vi.mock('#server/utils/db', () => ({
  query: mockQuery,
  withTransaction: mockWithTransaction,
}))
vi.mock('h3', () => ({ readBody: mockReadBody }))

// ============ 辅助 ============

const ADMIN = { id: 1, role: 1 }

function makeEvent(opts: { user?: unknown; query?: Record<string, string>; params?: Record<string, string>; body?: unknown } = {}) {
  return {
    context: { user: opts.user },
    __query: opts.query,
    __params: opts.params,
    __body: opts.body,
  } as any
}

beforeEach(() => {
  vi.clearAllMocks()
  mockWithTransaction.mockImplementation(async (fn: any) => fn({ execute: mockConnExecute }))
  mockReadBody.mockImplementation(async (event: any) => event.__body)
})

// ============ 权限门禁（403） ============

describe('管理员材料接口 - 权限', () => {
  it('非管理员调用列表/详情/编辑/删除均返回 403', async () => {
    const user = { id: 2, role: 0 }
    expect((await listHandler(makeEvent({ user }))).code).toBe(403)
    expect((await detailHandler(makeEvent({ user, params: { segId: '1' } }))).code).toBe(403)
    expect((await putHandler(makeEvent({ user, params: { segId: '1' }, body: {} }))).code).toBe(403)
    expect((await deleteHandler(makeEvent({ user, params: { segId: '1' } }))).code).toBe(403)
  })

  it('未登录（无 user）返回 403', async () => {
    expect((await listHandler(makeEvent({}))).code).toBe(403)
  })
})

// ============ 列表：查询参数强转 + 筛选 ============

describe('管理员材料列表 - 参数强转与筛选', () => {
  it('query 字符串参数（page/unitId/isPublic）经 zod coerce 为数字，不再 400', async () => {
    mockQuery
      .mockResolvedValueOnce([])                    // 主查询
      .mockResolvedValueOnce([{ total: 0 }])        // COUNT

    const res = await listHandler(makeEvent({
      user: ADMIN,
      query: { page: '2', pageSize: '20', unitId: '0', isPublic: '1' },
    }))

    expect(res.code).toBe(200)
    // 第一次查询的参数：[unitId, isPublic, pageSize, offset]，均应为数字
    const params = mockQuery.mock.calls[0]![1]
    expect(params[0]).toBe(0)          // unitId 字符串 '0' → 数字 0
    expect(params[1]).toBe(1)          // isPublic 字符串 '1' → 数字 1
    expect(params[2]).toBe(20)         // pageSize
    expect(params[3]).toBe(20)         // offset = (2-1)*20
    // WHERE 含软删除过滤与筛选条件
    const sql = mockQuery.mock.calls[0]![0] as string
    expect(sql).toContain('s.deleted_at IS NULL')
    expect(sql).toContain('s.unit_id = ?')
    expect(sql).toContain('s.is_public = ?')
  })

  it('keyword 以 LIKE 参数化传递（含通配符）', async () => {
    mockQuery.mockResolvedValueOnce([]).mockResolvedValueOnce([{ total: 0 }])
    await listHandler(makeEvent({ user: ADMIN, query: { keyword: '英语' } }))
    const params = mockQuery.mock.calls[0]![1]
    expect(params).toContain('%英语%')
  })
})

// ============ 详情：404 与数据组装 ============

describe('管理员材料详情', () => {
  it('材料不存在或已删除返回 404', async () => {
    mockQuery.mockResolvedValueOnce([])
    const res = await detailHandler(makeEvent({ user: ADMIN, params: { segId: '999' } }))
    expect(res.code).toBe(404)
  })

  it('segId 非数字返回 400', async () => {
    const res = await detailHandler(makeEvent({ user: ADMIN, params: { segId: 'abc' } }))
    expect(res.code).toBe(400)
  })

  it('成功时返回解析后的 questions 与词汇列表', async () => {
    const segmentRow = {
      id: 5, unit_id: 1, title: 'T', textContent: 'text', translation: '译',
      questions: [{ question: 'q', options: ['a', 'b'], answer: 'a' }],
      is_public: 1, sort_order: 0, createdAt: '2026-01-01', deleted_at: null, unitTitle: 'U1',
    }
    const vocabRow = { id: 10, segment_id: 5, word: 'w', forms: null, phonetic: null, meaning: 'm', exampleSentence: null, exampleTranslation: null, media_id: null, sort_order: 0, createdAt: '2026-01-01' }
    mockQuery.mockResolvedValueOnce([segmentRow]).mockResolvedValueOnce([vocabRow])

    const res = await detailHandler(makeEvent({ user: ADMIN, params: { segId: '5' } }))

    expect(res.code).toBe(200)
    expect(res.data.questions).toHaveLength(1)
    expect(res.data!.vocabulary![0]!.word).toBe('w')
    expect(res.data.unitTitle).toBe('U1')
  })
})

// ============ 编辑：schema 校验 + 词汇 diff + JSON.stringify ============

describe('管理员材料编辑', () => {
  const validBody = {
    title: '标题',
    textContent: 'This is a valid material text content.',
    translation: '翻译',
    questions: [{ question: 'q', options: ['a', 'b'], answer: 'a' }],
    vocabulary: [
      { id: 10, word: 'keep', meaning: '保留' },
      { word: 'newword', meaning: '新词' },
    ],
    isPublic: 0,
  }

  it('title 为空返回 400（schema 拒绝）', async () => {
    const res = await putHandler(makeEvent({ user: ADMIN, params: { segId: '5' }, body: { ...validBody, title: '' } }))
    expect(res.code).toBe(400)
    expect(mockWithTransaction).not.toHaveBeenCalled()
  })

  it('textContent 少于 10 字符返回 400', async () => {
    const res = await putHandler(makeEvent({ user: ADMIN, params: { segId: '5' }, body: { ...validBody, textContent: 'short' } }))
    expect(res.code).toBe(400)
  })

  it('材料不存在返回 404', async () => {
    mockQuery.mockResolvedValueOnce([])
    const res = await putHandler(makeEvent({ user: ADMIN, params: { segId: '999' }, body: validBody }))
    expect(res.code).toBe(404)
  })

  it('成功：questions 以 JSON 字符串写入，词汇执行 update/insert/delete diff', async () => {
    mockQuery.mockResolvedValueOnce([{ id: 5, is_public: 1 }])   // 存在性校验
    mockConnExecute.mockResolvedValue([{ affectedRows: 1 }])

    const res = await putHandler(makeEvent({ user: ADMIN, params: { segId: '5' }, body: validBody }))

    expect(res.code).toBe(200)
    // UPDATE segment + DELETE 未保留词汇 + UPDATE 词汇10 + INSERT 新词 = 4 次
    expect(mockConnExecute).toHaveBeenCalledTimes(4)

    // 第 1 次：UPDATE segment，questions 参数必须是 JSON 字符串
    const [segSql, segParams] = mockConnExecute.mock.calls[0]!
    expect(segSql).toContain('UPDATE segment')
    const questionsParam = segParams[3]
    expect(typeof questionsParam).toBe('string')
    expect(JSON.parse(questionsParam)).toEqual(validBody.questions)
    // isPublic 传 0（payload 覆盖）
    expect(segParams[4]).toBe(0)

    // 第 2 次：DELETE 未保留的词汇（保留 id=10）
    const [delSql, delParams] = mockConnExecute.mock.calls[1]!
    expect(delSql).toContain('DELETE FROM vocabulary')
    expect(delSql).toContain('NOT IN')
    expect(delParams).toEqual([5, 10])

    // 第 3 次：UPDATE 词汇（id=10），SQL 不得包含 media_id
    const [updSql, updParams] = mockConnExecute.mock.calls[2]!
    expect(updSql).toContain('UPDATE vocabulary')
    expect(updSql).not.toContain('media_id')
    expect(updParams).toContain(10)

    // 第 4 次：INSERT 新词
    const [insSql] = mockConnExecute.mock.calls[3]!
    expect(insSql).toContain('INSERT INTO vocabulary')
  })
})

// ============ 软删除：affectedRows ============

describe('管理员材料软删除', () => {
  it('affectedRows=0（不存在或已删除）返回 404', async () => {
    mockQuery.mockResolvedValueOnce({ affectedRows: 0 })
    const res = await deleteHandler(makeEvent({ user: ADMIN, params: { segId: '999' } }))
    expect(res.code).toBe(404)
  })

  it('成功软删除返回 200，SQL 置 deleted_at', async () => {
    mockQuery.mockResolvedValueOnce({ affectedRows: 1 })
    const res = await deleteHandler(makeEvent({ user: ADMIN, params: { segId: '5' } }))
    expect(res.code).toBe(200)
    const sql = mockQuery.mock.calls[0]![0] as string
    expect(sql).toContain('deleted_at = NOW()')
    expect(sql).toContain('deleted_at IS NULL')
  })
})
