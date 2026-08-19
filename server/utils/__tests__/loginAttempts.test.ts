import { describe, it, expect, vi, beforeEach } from 'vitest'

import { getFailCount, recordFail, resetFail, CAPTCHA_THRESHOLD } from '../loginAttempts'

// loginAttempts 计数已外置 rateStore（P2），mock 三个窄接口并按用例编排返回值
// （incrWindow 返回递增 count 模拟固窗计数；真实固窗/refreshTtl 语义由 rateStore.test.ts 覆盖）。
// alertEventLog（→ db → useRuntimeConfig）与 fileLogger 一并 mock 掉避免 node 环境崩。
const { mockIncrWindow, mockGetCount, mockResetKey, mockLogAlertEvent, mockQuery } = vi.hoisted(
  () => ({
    mockIncrWindow: vi.fn(),
    mockGetCount: vi.fn(),
    mockResetKey: vi.fn(),
    mockLogAlertEvent: vi.fn(),
    mockQuery: vi.fn(),
  }),
)
vi.mock('#server/utils/rateStore', () => ({
  incrWindow: mockIncrWindow,
  getCount: mockGetCount,
  resetKey: mockResetKey,
}))
vi.mock('../db', () => ({ query: mockQuery }))
vi.mock('../alertEventLog', () => ({ logAlertEvent: mockLogAlertEvent }))
vi.mock('../fileLogger', () => ({ fileLog: vi.fn(), fileLogError: vi.fn() }))
vi.mock('../../../shared/utils/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), log: vi.fn(), debug: vi.fn() },
}))

beforeEach(() => {
  vi.clearAllMocks()
})

describe('loginAttempts', () => {
  it('CAPTCHA_THRESHOLD 为 3', () => {
    expect(CAPTCHA_THRESHOLD).toBe(3)
  })

  it('初始计数为 0', async () => {
    mockGetCount.mockResolvedValueOnce(0)
    await expect(getFailCount('acc-init')).resolves.toBe(0)
    expect(mockGetCount).toHaveBeenCalledWith('fail', 'acc-init')
  })

  it('recordFail 递增，getFailCount 反映次数', async () => {
    const a = 'acc-incr'
    mockIncrWindow.mockResolvedValueOnce({ count: 1, retryAfterSec: 1800 })
    mockIncrWindow.mockResolvedValueOnce({ count: 2, retryAfterSec: 1800 })
    mockGetCount.mockResolvedValueOnce(2)
    await recordFail(a)
    await recordFail(a)
    await expect(getFailCount(a)).resolves.toBe(2)
    // fail 域 30min 窗口 + refreshTtl：每次失败刷新过期（最后一次失败后 30min 清零）
    expect(mockIncrWindow).toHaveBeenNthCalledWith(1, 'fail', a, 1800, { refreshTtl: true })
    expect(mockIncrWindow).toHaveBeenNthCalledWith(2, 'fail', a, 1800, { refreshTtl: true })
    // 未达阈值不触发安全事件
    expect(mockLogAlertEvent).not.toHaveBeenCalled()
  })

  it('连错 3 次达到阈值，触发安全事件', async () => {
    const a = 'acc-threshold'
    mockIncrWindow.mockResolvedValueOnce({ count: 1, retryAfterSec: 1800 })
    mockIncrWindow.mockResolvedValueOnce({ count: 2, retryAfterSec: 1800 })
    mockIncrWindow.mockResolvedValueOnce({ count: 3, retryAfterSec: 1800 })
    mockGetCount.mockResolvedValueOnce(3)
    await recordFail(a)
    await recordFail(a)
    await recordFail(a)
    await expect(getFailCount(a)).resolves.toBeGreaterThanOrEqual(CAPTCHA_THRESHOLD)
    // 第 3 次失败触发 login_brute_force 安全事件（context.count 用 incrWindow 返回值）
    expect(mockLogAlertEvent).toHaveBeenCalledTimes(1)
    expect(mockLogAlertEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'security',
        code: 'login_brute_force',
        context: { account: a, count: 3 },
      }),
    )
  })

  it('resetFail 清零计数', async () => {
    const a = 'acc-reset'
    mockIncrWindow.mockResolvedValueOnce({ count: 1, retryAfterSec: 1800 })
    mockResetKey.mockResolvedValueOnce(undefined)
    mockGetCount.mockResolvedValueOnce(0)
    await recordFail(a)
    await resetFail(a)
    await expect(getFailCount(a)).resolves.toBe(0)
    expect(mockResetKey).toHaveBeenCalledWith('fail', a)
  })

  it('超过 TTL（30 分钟）计数过期归零', async () => {
    // 窗口过期语义由 rateStore 承载：过期键 getCount 返回 0（refreshTtl 刷新的 30min 到期后）
    const a = 'acc-ttl'
    mockIncrWindow.mockResolvedValueOnce({ count: 1, retryAfterSec: 1800 })
    await recordFail(a)
    mockGetCount.mockResolvedValueOnce(0)
    await expect(getFailCount(a)).resolves.toBe(0)
  })
})
