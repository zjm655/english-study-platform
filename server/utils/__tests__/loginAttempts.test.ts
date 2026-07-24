import { describe, it, expect, vi } from 'vitest'

import { getFailCount, recordFail, resetFail, CAPTCHA_THRESHOLD } from '../loginAttempts'

// 注：failMap 为模块级状态，各用例用唯一 account 避免相互污染

describe('loginAttempts', () => {
  it('CAPTCHA_THRESHOLD 为 3', () => {
    expect(CAPTCHA_THRESHOLD).toBe(3)
  })

  it('初始计数为 0', () => {
    expect(getFailCount('acc-init')).toBe(0)
  })

  it('recordFail 递增，getFailCount 反映次数', () => {
    const a = 'acc-incr'
    recordFail(a)
    recordFail(a)
    expect(getFailCount(a)).toBe(2)
  })

  it('连错 3 次达到阈值', () => {
    const a = 'acc-threshold'
    recordFail(a)
    recordFail(a)
    recordFail(a)
    expect(getFailCount(a)).toBeGreaterThanOrEqual(CAPTCHA_THRESHOLD)
  })

  it('resetFail 清零计数', () => {
    const a = 'acc-reset'
    recordFail(a)
    recordFail(a)
    resetFail(a)
    expect(getFailCount(a)).toBe(0)
  })

  it('超过 TTL（30 分钟）计数过期归零', () => {
    vi.useFakeTimers()
    try {
      const a = 'acc-ttl'
      recordFail(a)
      expect(getFailCount(a)).toBe(1)
      vi.advanceTimersByTime(31 * 60_000)
      expect(getFailCount(a)).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })
})
