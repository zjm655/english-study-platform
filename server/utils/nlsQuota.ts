// server/utils/nlsQuota.ts
// NLS 免费额度信息推导（server-only 纯工具，无 DB/云依赖，便于单测）
import type { NlsQuotaInfo } from '#shared/types/nlsQuota'

/** 标准版 filetrans 每日免费额度（分钟） */
export const NLS_DAILY_FREE_QUOTA_MIN = 120
/** 超出免费额度后的按量单价（元/小时），与 cloudEstimate 的 NLS_PRICE_PER_HOUR 口径一致 */
export const NLS_PAID_PRICE_PER_HOUR = 2.5
/** 免费额度使用提醒阈值（百分比） */
export const NLS_WARN_THRESHOLD_PERCENT = 80

export interface DeriveNlsQuotaParams {
  /** 今日 filetrans 已用音频时长（毫秒） */
  usedMs: number
  /** 当前 STT 后端 */
  backend: 'filetrans' | 'flash'
  freeQuotaMin?: number
  paidUnitPricePerHour?: number
  warnThresholdPercent?: number
}

/**
 * 由今日 filetrans 已用时长推导 NLS 免费额度信息。
 * - usedPercent 基于精确分钟数计算（保留 1 位小数），usedMin 为取整后的展示值；
 * - remainingMin 下限 0；flash 后端无免费额度语义，usedPercent 恒为 0。
 */
export function deriveNlsQuotaInfo(params: DeriveNlsQuotaParams): NlsQuotaInfo {
  const freeQuotaMin = params.freeQuotaMin ?? NLS_DAILY_FREE_QUOTA_MIN
  const paidUnitPricePerHour = params.paidUnitPricePerHour ?? NLS_PAID_PRICE_PER_HOUR
  const warnThresholdPercent = params.warnThresholdPercent ?? NLS_WARN_THRESHOLD_PERCENT

  const usedMinExact = params.usedMs / 60_000
  const usedMin = Math.round(usedMinExact)
  const usedPercent =
    params.backend === 'filetrans' && freeQuotaMin > 0
      ? Math.round((usedMinExact / freeQuotaMin) * 1000) / 10
      : 0
  const remainingMin = Math.max(freeQuotaMin - usedMin, 0)

  return {
    freeQuotaMin,
    usedMin,
    remainingMin,
    usedPercent,
    paidUnitPricePerHour,
    warnThresholdPercent,
    backend: params.backend,
  }
}