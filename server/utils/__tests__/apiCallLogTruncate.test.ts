import { describe, it, expect, vi } from 'vitest'

import { truncateDiag, DIAG_MESSAGE_MAX, DIAG_STACK_MAX } from '../apiCallLog'

// apiCallLog 依赖链：db（模块级 useRuntimeConfig，node 测试环境不存在）→ 必须 mock 掉；
// logger 仅在运行期函数内使用，同样 mock 隔离。truncateDiag 本身是纯函数。
vi.mock('../db', () => ({ query: vi.fn() }))
vi.mock('../../../shared/utils/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), log: vi.fn(), debug: vi.fn() },
}))

const MARK = '...[truncated]'

describe('truncateDiag - 错误诊断文本截断', () => {
  it('空值归一为 null（null / undefined / 空串）', () => {
    expect(truncateDiag(null, 500)).toBeNull()
    expect(truncateDiag(undefined, 500)).toBeNull()
    expect(truncateDiag('', 500)).toBeNull()
  })

  it('未超限原样返回', () => {
    expect(truncateDiag('数据库连接失败', 500)).toBe('数据库连接失败')
  })

  it('恰好等于上限不截断', () => {
    const text = 'a'.repeat(500)
    expect(truncateDiag(text, 500)).toBe(text)
  })

  it('超限截断并追加标记，总长不超过 max（保证不超出 DB 列宽）', () => {
    const result = truncateDiag('x'.repeat(600), DIAG_MESSAGE_MAX)!
    expect(result.endsWith(MARK)).toBe(true)
    expect(result.length).toBe(DIAG_MESSAGE_MAX)
    expect(result.length).toBeLessThanOrEqual(500) // error_message 列 VARCHAR(500)
  })

  it('stack 上限 4000 同样生效', () => {
    const result = truncateDiag('s'.repeat(10_000), DIAG_STACK_MAX)!
    expect(result.endsWith(MARK)).toBe(true)
    expect(result.length).toBe(DIAG_STACK_MAX)
  })

  it('上限常量与约定一致：message 500 / stack 4000', () => {
    expect(DIAG_MESSAGE_MAX).toBe(500)
    expect(DIAG_STACK_MAX).toBe(4000)
  })
})
