/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import handler from '../client-error.post'

// ===== Nuxt 自动注入全局函数（vitest node 环境需手动挂） =====
vi.hoisted(() => {
  ;(globalThis as any).defineEventHandler = (handler: any) => handler
})

// ===== hoisted mock 引用 =====
const { mockGetSysConfigKeys, mockLogAlertEvent, mockReadBody } = vi.hoisted(() => ({
  mockGetSysConfigKeys: vi.fn(),
  mockLogAlertEvent: vi.fn(),
  mockReadBody: vi.fn(),
}))

// ===== 全局挂载 auto-import =====
;(globalThis as any).readBody = mockReadBody

// ===== 模块 mock（handler 显式 import 的依赖） =====
// validate 与 clientErrorReportSchema 用真实实现（纯函数 + zod，无 IO）
vi.mock('#server/utils/configStore', () => ({ getSysConfigKeys: mockGetSysConfigKeys }))
vi.mock('#server/utils/alertEventLog', () => ({ logAlertEvent: mockLogAlertEvent }))

beforeEach(() => {
  vi.clearAllMocks()
})

// 构造 event 辅助
function makeEvent(): any {
  return { _body: undefined }
}

// ===== 总开关（configStore，缺键/异常=默认开） =====

describe('client-error 总开关', () => {
  it("开关='0' → 静默接受返回 ok，不解析 body、不写事件", async () => {
    mockGetSysConfigKeys.mockResolvedValueOnce(new Map([['client_error_report_enabled', '0']]))
    const res = await handler(makeEvent())
    expect(res).toEqual({ code: 200, message: 'ok', data: null })
    expect(mockReadBody).not.toHaveBeenCalled()
    expect(mockLogAlertEvent).not.toHaveBeenCalled()
  })

  it("开关='1' → 默认开：校验通过后写事件", async () => {
    mockGetSysConfigKeys.mockResolvedValueOnce(new Map([['client_error_report_enabled', '1']]))
    mockReadBody.mockResolvedValueOnce({ message: 'TypeError: boom' })
    const res = await handler(makeEvent())
    expect(res.code).toBe(200)
    expect(mockLogAlertEvent).toHaveBeenCalledTimes(1)
  })

  it('缺键（空 Map）→ 默认开：校验通过后写事件', async () => {
    mockGetSysConfigKeys.mockResolvedValueOnce(new Map())
    mockReadBody.mockResolvedValueOnce({ message: 'TypeError: boom' })
    const res = await handler(makeEvent())
    expect(res.code).toBe(200)
    expect(mockLogAlertEvent).toHaveBeenCalledTimes(1)
  })

  it('configStore 抛错 → 默认开（旁路不阻塞）：校验通过后写事件', async () => {
    mockGetSysConfigKeys.mockRejectedValueOnce(new Error('configStore down'))
    mockReadBody.mockResolvedValueOnce({ message: 'TypeError: boom' })
    const res = await handler(makeEvent())
    expect(res.code).toBe(200)
    expect(mockLogAlertEvent).toHaveBeenCalledTimes(1)
  })
})

// ===== 参数校验与事件字段 =====

describe('client-error 参数校验与事件字段', () => {
  it('message 缺失 → 400 且不写事件', async () => {
    mockGetSysConfigKeys.mockResolvedValueOnce(new Map())
    mockReadBody.mockResolvedValueOnce({})
    const res = await handler(makeEvent())
    expect(res.code).toBe(400)
    expect(mockLogAlertEvent).not.toHaveBeenCalled()
  })

  it('合法上报 → 事件 source=client_error / code=client_js_error / context 含 stack 与 url', async () => {
    mockGetSysConfigKeys.mockResolvedValueOnce(new Map())
    mockReadBody.mockResolvedValueOnce({
      message: 'UnhandledRejection',
      stack: 'Error\n    at foo',
      url: 'https://example.com/learn',
    })
    const res = await handler(makeEvent())
    expect(res.code).toBe(200)
    expect(mockLogAlertEvent).toHaveBeenCalledTimes(1)
    const entry = mockLogAlertEvent.mock.calls[0]![0]
    expect(entry.source).toBe('client_error')
    expect(entry.level).toBe('error')
    expect(entry.code).toBe('client_js_error')
    expect(entry.message).toBe('UnhandledRejection')
    expect(entry.context).toEqual({ stack: 'Error\n    at foo', url: 'https://example.com/learn' })
  })
})
