import { describe, it, expect, vi } from 'vitest'

import { describeError } from '../tts'

// ===== tts.describeError 测试 =====
// 目标：任意异常形态都必须产出「非空、可诊断」的错误描述 + 正确的结构化分类

// tts.ts 依赖链：cloudServiceLog → db（模块级 useRuntimeConfig，node 测试环境不存在）→ 必须 mock 掉
vi.mock('../cloudServiceLog', () => ({ logCloudServiceCall: vi.fn() }))
vi.mock('../fileLogger', () => ({ fileLog: vi.fn(), fileLogError: vi.fn() }))

describe('describeError', () => {
  it('AggregateError（空 message）：展开 errors[] 的 code，永不为空', () => {
    const agg = new AggregateError(
      [
        Object.assign(new Error('connect ECONNREFUSED 1.2.3.4:443'), { code: 'ECONNREFUSED' }),
        Object.assign(new Error(''), { code: 'ETIMEDOUT' }),
      ],
      '',
    )
    const { message, kind } = describeError(agg)
    expect(message).toContain('AggregateError')
    expect(message).toContain('ECONNREFUSED')
    expect(message).toContain('ETIMEDOUT')
    expect(kind).toBe('network')
  })

  it('AggregateError 且 errors 为空数组：兜底为未知错误', () => {
    const { message, kind } = describeError(new AggregateError([], ''))
    expect(message).toBe('未知错误(空message)')
    expect(kind).toBe('unknown')
  })

  it('仅有 code 无 message 的 ErrnoException：取 name(code)', () => {
    const err = Object.assign(new Error(''), { code: 'ECONNRESET' })
    const { message, kind } = describeError(err)
    expect(message).toBe('Error(ECONNRESET)')
    expect(kind).toBe('network')
  })

  it('message 与 code 全空的 Error：取 name，永不为空', () => {
    const { message, kind } = describeError(new Error(''))
    expect(message).toBe('Error')
    expect(kind).toBe('unknown')
  })

  it('非 Error 值：String 化', () => {
    expect(describeError('boom').message).toBe('boom')
    expect(describeError(42).message).toBe('42')
  })

  it('null/undefined/空串：兜底为未知错误', () => {
    expect(describeError(null).message).toBe('未知错误(空message)')
    expect(describeError(undefined).message).toBe('未知错误(空message)')
    expect(describeError('').message).toBe('未知错误(空message)')
  })

  it('分类：403 → auth（优先级最高，即使同时含其他关键词）', () => {
    expect(describeError(new Error('Unexpected server response: 403')).kind).toBe('auth')
  })

  it('分类：超时 → timeout', () => {
    expect(describeError(new Error('连接超时')).kind).toBe('timeout')
    expect(describeError(new Error('TTS 转换超时')).kind).toBe('timeout')
  })

  it('分类：代理 502 握手拒绝 → network', () => {
    expect(describeError(new Error('Unexpected server response: 502')).kind).toBe('network')
  })

  it('分类：ws 关闭 → closed（携带 close code 诊断信息）', () => {
    const { message, kind } = describeError(
      new Error('WebSocket 意外关闭 code=1011 reason=upstream error'),
    )
    expect(kind).toBe('closed')
    expect(message).toContain('code=1011')
  })
})
