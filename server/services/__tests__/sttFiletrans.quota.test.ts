// server/services/__tests__/sttFiletrans.quota.test.ts
// TDD：先于 deriveNlsQuotaInfo 编写，预期全部失败
import { describe, it, expect } from 'vitest'
import {
  deriveNlsQuotaInfo,
  NLS_DAILY_FREE_QUOTA_MIN,
} from '#server/utils/nlsQuota'

// ============ deriveNlsQuotaInfo ============

describe('deriveNlsQuotaInfo', () => {
  it('已用为 0 时：剩余=免费额度，百分比=0', () => {
    const info = deriveNlsQuotaInfo({ usedMs: 0, backend: 'filetrans' })

    expect(info.freeQuotaMin).toBe(NLS_DAILY_FREE_QUOTA_MIN)
    expect(info.usedMin).toBe(0)
    expect(info.remainingMin).toBe(NLS_DAILY_FREE_QUOTA_MIN)
    expect(info.usedPercent).toBe(0)
    expect(info.backend).toBe('filetrans')
  })

  it('已用恰好 1 小时：百分比=50，剩余 1 小时', () => {
    const info = deriveNlsQuotaInfo({ usedMs: 3_600_000, backend: 'filetrans' })

    expect(info.usedMin).toBe(60)
    expect(info.usedPercent).toBe(50)
    expect(info.remainingMin).toBe(60)
  })

  it('百分比保留 1 位小数（如 60.4%）', () => {
    // 72.5 分钟 → 120 分钟额度的 60.4%
    const info = deriveNlsQuotaInfo({ usedMs: 72.5 * 60_000, backend: 'filetrans' })

    expect(info.usedPercent).toBe(60.4)
    expect(info.usedMin).toBe(73)
  })

  it('已用超过免费额度：剩余下限为 0，百分比可 >100', () => {
    const info = deriveNlsQuotaInfo({ usedMs: 5 * 3_600_000, backend: 'filetrans' })

    expect(info.remainingMin).toBe(0)
    expect(info.usedPercent).toBeGreaterThan(100)
  })

  it('flash 后端透传，且无免费额度语义时百分比按 0 处理', () => {
    const info = deriveNlsQuotaInfo({ usedMs: 60_000, backend: 'flash' })

    expect(info.backend).toBe('flash')
    expect(info.usedPercent).toBe(0)
  })

  it('默认阈值 80 与按量单价 2.5 可被覆盖', () => {
    const info = deriveNlsQuotaInfo({
      usedMs: 0,
      backend: 'filetrans',
      freeQuotaMin: 60,
      paidUnitPricePerHour: 3,
      warnThresholdPercent: 70,
    })

    expect(info.freeQuotaMin).toBe(60)
    expect(info.paidUnitPricePerHour).toBe(3)
    expect(info.warnThresholdPercent).toBe(70)
  })
})