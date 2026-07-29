/**
 * collation 模块单元测试（vitest.server.config.ts 口径：server/**\/*.test.ts）。
 *
 * 覆盖：
 * - applyCollation 的占位符字面量替换（单处/无/多处）。
 * - resolveCollation 的 env 读取、默认回退、注入校验、未知值放行。
 *
 * 注意：resolveCollation 依赖 process.env.NUXT_DB_COLLATION，
 * 每个用例前保存、用例后恢复，避免污染其它测试。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { DEFAULT_COLLATION, resolveCollation, applyCollation } from '../collation'

describe('applyCollation', () => {
  it('单占位符替换', () => {
    const sql = 'CREATE TABLE t (a varchar(10) COLLATE ${COLLATION} NOT NULL);'
    expect(applyCollation(sql, 'utf8mb4_unicode_ci')).toBe(
      'CREATE TABLE t (a varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL);',
    )
  })

  it('无占位符时原样返回', () => {
    const sql = "SELECT * FROM user WHERE nickname = '${OTHER}';"
    expect(applyCollation(sql, 'utf8mb4_unicode_ci')).toBe(sql)
  })

  it('多处占位符全部替换', () => {
    const sql = [
      '`title` varchar(100) COLLATE ${COLLATION} NOT NULL,',
      '`content` text COLLATE ${COLLATION} NULL',
      ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=${COLLATION};',
    ].join('\n')
    const result = applyCollation(sql, 'utf8mb4_general_ci')
    expect(result).not.toContain('${COLLATION}')
    expect(result.match(/utf8mb4_general_ci/g)).toHaveLength(3)
  })
})

describe('resolveCollation', () => {
  // 保存/恢复环境变量，避免用例间与跨文件污染
  let saved: string | undefined

  beforeEach(() => {
    saved = process.env.NUXT_DB_COLLATION
  })

  afterEach(() => {
    if (saved === undefined) {
      delete process.env.NUXT_DB_COLLATION
    } else {
      process.env.NUXT_DB_COLLATION = saved
    }
    vi.restoreAllMocks()
  })

  it('未设置 env 时返回默认 utf8mb4_0900_ai_ci', () => {
    delete process.env.NUXT_DB_COLLATION
    expect(resolveCollation()).toBe(DEFAULT_COLLATION)
    expect(DEFAULT_COLLATION).toBe('utf8mb4_0900_ai_ci')
  })

  it('env 为空串时返回默认值', () => {
    process.env.NUXT_DB_COLLATION = ''
    expect(resolveCollation()).toBe(DEFAULT_COLLATION)
  })

  it('env 设为 utf8mb4_unicode_ci 时返回之', () => {
    process.env.NUXT_DB_COLLATION = 'utf8mb4_unicode_ci'
    expect(resolveCollation()).toBe('utf8mb4_unicode_ci')
  })

  it('非法值（含空格）抛错', () => {
    process.env.NUXT_DB_COLLATION = 'utf8mb4 unicode'
    expect(() => resolveCollation()).toThrow(/非法/)
  })

  it('非法值（含分号，SQL 注入特征）抛错', () => {
    process.env.NUXT_DB_COLLATION = 'utf8mb4_unicode_ci; DROP TABLE user'
    expect(() => resolveCollation()).toThrow(/非法/)
  })

  it('非法值（含引号）抛错', () => {
    process.env.NUXT_DB_COLLATION = "utf8mb4'ci"
    expect(() => resolveCollation()).toThrow(/非法/)
  })

  it('未知但格式合法的值 console.warn 后放行', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    process.env.NUXT_DB_COLLATION = 'utf8mb4_bin'
    expect(resolveCollation()).toBe('utf8mb4_bin')
    expect(warnSpy).toHaveBeenCalledOnce()
  })
})
