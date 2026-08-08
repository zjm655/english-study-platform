import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { LogCfg } from '~/types/requestType'
import { resolveCode } from '~/utils/resolveCode'

// Mock popup（resolveCode 显式 import）
const { mockToastSuccess, mockToastError, mockToastWarning, mockToastInfo } = vi.hoisted(() => ({
  mockToastSuccess: vi.fn(),
  mockToastError: vi.fn(),
  mockToastWarning: vi.fn(),
  mockToastInfo: vi.fn(),
}))
vi.mock('~/utils/popup', () => ({
  toastSuccess: mockToastSuccess,
  toastError: mockToastError,
  toastWarning: mockToastWarning,
  toastInfo: mockToastInfo,
}))

// Mock useUserStore（401/403 分支会 clearUser）
const mockClearUser = vi.fn()
vi.mock('~/store/useUserStore', () => ({
  useUserStore: () => ({ clearUser: mockClearUser }),
}))

// Stub Nuxt auto-imports（vitest 环境无 Nuxt runtime）
const mockNavigateTo = vi.fn()
const tokenCookie = { value: null as string | null }
vi.stubGlobal('navigateTo', mockNavigateTo)
vi.stubGlobal('useCookie', () => tokenCookie)
vi.stubGlobal('logger', { log: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn() })

const tips = {
  success: '操作成功',
  clientFail: '客户端失败文案',
  serverFail: '服务端失败文案',
  error: '网络异常文案',
}

function makeCfg(over: Partial<LogCfg> = {}): LogCfg {
  return { code: 200, message: '接口消息', tips, ...over }
}

// 401/403 节流是模块级时间戳：用 fake timers 每个用例把基准时间前推 100s，
// 保证跨用例节流窗口必然过期，互不干扰
let baseTime = 1_700_000_000_000

beforeEach(() => {
  vi.clearAllMocks()
  tokenCookie.value = null
  vi.useFakeTimers()
  baseTime += 100_000
  vi.setSystemTime(baseTime)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('resolveCode toast 分级（写弹读静默）', () => {
  it('notify 缺省时所有常规分支全静默（现状回归保障）', async () => {
    for (const code of [200, 400, 500, 404, -1, 999]) {
      await resolveCode(makeCfg({ code }))
    }
    expect(mockToastSuccess).not.toHaveBeenCalled()
    expect(mockToastError).not.toHaveBeenCalled()
    expect(mockToastInfo).not.toHaveBeenCalled()
  })

  it("notify='fail' 时失败分支弹 toastError、成功不弹", async () => {
    await resolveCode(makeCfg({ code: 200, notify: 'fail' }))
    expect(mockToastSuccess).not.toHaveBeenCalled()

    // message 为空时回退 tips 文案（服务端未返回具体原因）
    await resolveCode(makeCfg({ code: 400, message: '', notify: 'fail' }))
    expect(mockToastError).toHaveBeenLastCalledWith('客户端失败文案')
    await resolveCode(makeCfg({ code: 500, message: '', notify: 'fail' }))
    expect(mockToastError).toHaveBeenLastCalledWith('服务端失败文案')
    await resolveCode(makeCfg({ code: -1, notify: 'fail' }))
    expect(mockToastError).toHaveBeenLastCalledWith('网络异常文案')
    expect(mockToastError).toHaveBeenCalledTimes(3)
  })

  it("notify='fail' 时 400/500 优先透出服务端 message（业务拒绝/服务器错误的原因不被 tips 吞掉）", async () => {
    await resolveCode(makeCfg({ code: 400, notify: 'fail', message: '队列已满，请稍后再试' }))
    expect(mockToastError).toHaveBeenLastCalledWith('队列已满，请稍后再试')
    await resolveCode(makeCfg({ code: 500, notify: 'fail', message: '服务器异常，请稍后重试' }))
    expect(mockToastError).toHaveBeenLastCalledWith('服务器异常，请稍后重试')
    // 空白 message 同样回退 tips
    await resolveCode(makeCfg({ code: 400, message: '   ', notify: 'fail' }))
    expect(mockToastError).toHaveBeenLastCalledWith('客户端失败文案')
  })

  it('网络异常（code -1，message 为 ofetch 英文原文）仍弹 tips.error，不直弹英文', async () => {
    await resolveCode(
      makeCfg({ code: -1, notify: 'fail', message: 'AbortError: The operation was aborted.' }),
    )
    expect(mockToastError).toHaveBeenLastCalledWith('网络异常文案')
  })

  it("notify='all' 时成功弹 toastSuccess，文案取 tips.success", async () => {
    await resolveCode(makeCfg({ code: 200, notify: 'all' }))
    expect(mockToastSuccess).toHaveBeenCalledWith('操作成功')
  })

  it("notify='all' 但成功文案为空串时不弹（兼容 success: '' 配置）", async () => {
    await resolveCode(
      makeCfg({ code: 200, message: '', notify: 'all', tips: { ...tips, success: '' } }),
    )
    expect(mockToastSuccess).not.toHaveBeenCalled()
  })

  it('silent=true 时即使 notify 打开也抑制常规 toast', async () => {
    await resolveCode(makeCfg({ code: 200, notify: 'all' }), true)
    await resolveCode(makeCfg({ code: 400, notify: 'all' }), true)
    expect(mockToastSuccess).not.toHaveBeenCalled()
    expect(mockToastError).not.toHaveBeenCalled()
  })

  it('428 为业务流转码：不弹提示、不跳转（登录验证码流程由页面承接）', async () => {
    await resolveCode(makeCfg({ code: 428, notify: 'all' }))
    expect(mockToastSuccess).not.toHaveBeenCalled()
    expect(mockToastError).not.toHaveBeenCalled()
    expect(mockToastWarning).not.toHaveBeenCalled()
    expect(mockNavigateTo).not.toHaveBeenCalled()
  })
})

describe('resolveCode 401/403 登录引导', () => {
  it('401 有 token（登录过期）：弹「登录已过期」+ 清 cookie + clearUser + 跳 /login', async () => {
    tokenCookie.value = 'jwt-token'
    await resolveCode(makeCfg({ code: 401, message: '' }))
    expect(mockToastWarning).toHaveBeenCalledWith('登录已过期，请重新登录')
    expect(tokenCookie.value).toBeNull()
    expect(mockClearUser).toHaveBeenCalled()
    expect(mockNavigateTo).toHaveBeenCalledWith('/login')
  })

  it('401 无 token（游客触碰登录态功能）：弹「此功能需要登录」，不跳转', async () => {
    tokenCookie.value = null
    await resolveCode(makeCfg({ code: 401, message: '' }))
    expect(mockToastWarning).toHaveBeenCalledWith('此功能需要登录')
    expect(mockClearUser).not.toHaveBeenCalled()
    expect(mockNavigateTo).not.toHaveBeenCalled()
  })

  it('401 游客提示不受 silent 影响（toast 仍执行）', async () => {
    await resolveCode(makeCfg({ code: 401, message: '' }), true)
    expect(mockToastWarning).toHaveBeenCalledWith('此功能需要登录')
    expect(mockNavigateTo).not.toHaveBeenCalled()
  })

  it('401 携带服务端 message（如登录失败）：优先透出服务端文案，不吞真实原因', async () => {
    tokenCookie.value = null
    await resolveCode(makeCfg({ code: 401, message: '账号已注销' }))
    expect(mockToastWarning).toHaveBeenCalledWith('账号已注销')
    expect(mockNavigateTo).not.toHaveBeenCalled()
    // 有 token 时同样优先透出服务端文案（清 cookie + 跳转流程不变）；跨过节流窗口
    vi.advanceTimersByTime(3001)
    tokenCookie.value = 'jwt-token'
    await resolveCode(makeCfg({ code: 401, message: '账号或密码错误' }))
    expect(mockToastWarning).toHaveBeenLastCalledWith('账号或密码错误')
    expect(mockNavigateTo).toHaveBeenCalledWith('/login')
  })

  it('并发 401 节流：3s 窗口内只弹一次，窗口过后可再弹', async () => {
    await resolveCode(makeCfg({ code: 401, message: '' }))
    await resolveCode(makeCfg({ code: 401, message: '' }))
    await resolveCode(makeCfg({ code: 401, message: '' }))
    expect(mockToastWarning).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(3001)
    await resolveCode(makeCfg({ code: 401, message: '' }))
    expect(mockToastWarning).toHaveBeenCalledTimes(2)
  })

  it('403：弹「权限不足」+ 清用户态 + 跳首页', async () => {
    await resolveCode(makeCfg({ code: 403, message: '' }))
    expect(mockToastWarning).toHaveBeenCalledWith('权限不足')
    expect(mockClearUser).toHaveBeenCalled()
    expect(mockNavigateTo).toHaveBeenCalledWith('/')
  })
})
