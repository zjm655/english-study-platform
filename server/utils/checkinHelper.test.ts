import { describe, it, expect } from 'vitest'
import { isStreakBroken, formatDatetime } from './checkinHelper'

describe('isStreakBroken', () => {
  const now = new Date('2024-07-05T09:00:00')

  it('lastCheckinTime 为 null 视为未中断', () => {
    expect(isStreakBroken(null, now)).toBe(false)
  })

  it('今天签到过 → 未中断', () => {
    expect(isStreakBroken(formatDatetime(new Date('2024-07-05T08:00:00')), now)).toBe(false)
  })

  it('昨天签到过 → 未中断', () => {
    expect(isStreakBroken(formatDatetime(new Date('2024-07-04T20:00:00')), now)).toBe(false)
  })

  it('前天签到 → 已中断', () => {
    expect(isStreakBroken(formatDatetime(new Date('2024-07-03T20:00:00')), now)).toBe(true)
  })

  it('更早的日期 → 已中断', () => {
    expect(isStreakBroken('2024-06-01 12:00:00', now)).toBe(true)
  })

  it('非法日期字符串 → 视为未中断（安全方向）', () => {
    expect(isStreakBroken('not-a-date', now)).toBe(false)
  })
})
