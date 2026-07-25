import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useVerifySSR } from '../useVerifySSR'

// —— h3：断言 set-cookie 透传调用 ——
const { appendResponseHeaderMock } = vi.hoisted(() => ({
  appendResponseHeaderMock: vi.fn(),
}))
vi.mock('h3', () => ({ appendResponseHeader: appendResponseHeaderMock }))

// —— 用户 store：以纯对象替身隔离 pinia ——
const { mockStore } = vi.hoisted(() => ({
  mockStore: {
    user: null as unknown,
    isLogin: false,
    isVerify: false,
    checkinStats: null,
    setUser: vi.fn(),
    clearUser: vi.fn(),
  },
}))
vi.mock('~/store/useUserStore', () => ({ useUserStore: () => mockStore }))

// —— Nuxt 自动导入（测试环境无）——
const cookieRef = { value: null as string | null }
vi.stubGlobal('useCookie', () => cookieRef)

const fakeEvent = { __event: true }
vi.stubGlobal('useRequestEvent', () => fakeEvent)

const rawMock = vi.fn()
vi.stubGlobal('useRequestFetch', () => rawMock)

const navigateToMock = vi.fn()
vi.stubGlobal('navigateTo', navigateToMock)

const loggerWarnMock = vi.fn()
vi.stubGlobal('logger', { warn: loggerWarnMock, info: vi.fn(), log: vi.fn(), error: vi.fn() })

/** 构造 requestFetch 响应替身：触发 onResponse（携带 set-cookie 头）后返回 body */
function mockFetchResponse(body: unknown, setCookies: string[] = []) {
  rawMock.mockImplementation(
    async (_path: string, opts?: { onResponse?: (ctx: { response: unknown }) => void }) => {
      opts?.onResponse?.({
        response: { headers: { getSetCookie: () => setCookies } },
      })
      return body
    },
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  cookieRef.value = null
  mockStore.user = null
  mockStore.isLogin = false
  mockStore.isVerify = false
})

describe('useVerifySSR - 游客短路', () => {
  it('无 token cookie 时不发内部请求、不动 store', async () => {
    cookieRef.value = null
    await useVerifySSR()
    expect(rawMock).not.toHaveBeenCalled()
    expect(mockStore.setUser).not.toHaveBeenCalled()
    expect(mockStore.isVerify).toBe(false)
  })
})

describe('useVerifySSR - 校验成功', () => {
  it('code 200 时写入 user/isLogin/isVerify 三字段', async () => {
    cookieRef.value = 'jwt-token'
    const userData = { id: 1, nickname: '测试用户', role: 0 }
    mockFetchResponse({ code: 200, message: 'ok', data: userData })

    await useVerifySSR()

    expect(rawMock).toHaveBeenCalledTimes(1)
    expect(mockStore.setUser).toHaveBeenCalledWith(userData)
    expect(mockStore.isLogin).toBe(true)
    expect(mockStore.isVerify).toBe(true)
  })

  it('续期 Set-Cookie 逐条透传到外层响应 event', async () => {
    cookieRef.value = 'jwt-token'
    const cookies = ['token=renewed; Path=/; HttpOnly', 'other=1; Path=/']
    mockFetchResponse({ code: 200, message: 'ok', data: { id: 1 } }, cookies)

    await useVerifySSR()

    expect(appendResponseHeaderMock).toHaveBeenCalledTimes(2)
    expect(appendResponseHeaderMock).toHaveBeenNthCalledWith(1, fakeEvent, 'set-cookie', cookies[0])
    expect(appendResponseHeaderMock).toHaveBeenNthCalledWith(2, fakeEvent, 'set-cookie', cookies[1])
  })
})

describe('useVerifySSR - 失败降级', () => {
  it('业务 401 时不落状态、不清 cookie、不重定向（留给 client 兜底）', async () => {
    cookieRef.value = 'expired-token'
    mockFetchResponse({ code: 401, message: '未登录', data: null })

    await useVerifySSR()

    expect(mockStore.setUser).not.toHaveBeenCalled()
    expect(mockStore.isLogin).toBe(false)
    expect(mockStore.isVerify).toBe(false)
    expect(cookieRef.value).toBe('expired-token')
    expect(navigateToMock).not.toHaveBeenCalled()
  })

  it('网络异常/超时不抛出，静默降级并记录 warn', async () => {
    cookieRef.value = 'jwt-token'
    rawMock.mockRejectedValue(new Error('network error'))

    await expect(useVerifySSR()).resolves.toBeUndefined()

    expect(mockStore.setUser).not.toHaveBeenCalled()
    expect(mockStore.isVerify).toBe(false)
    expect(loggerWarnMock).toHaveBeenCalled()
    expect(navigateToMock).not.toHaveBeenCalled()
  })
})
