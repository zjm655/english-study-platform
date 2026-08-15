/**
 * NLS 免费额度信息（管理员上传页展示与超阈值提示）
 * GET /api/admin/material/nls-quota 下发，前端据此展示剩余免费额度并判断是否提示按量付费
 */
export interface NlsQuotaInfo {
  /** 每日免费额度（分钟），标准版 filetrans */
  freeQuotaMin: number
  /** 今日已用音频时长（分钟，取整） */
  usedMin: number
  /** 剩余免费额度（分钟，下限 0） */
  remainingMin: number
  /** 已用百分比（0-100+，保留 1 位小数；flash 后端无免费额度语义恒为 0） */
  usedPercent: number
  /** 超出免费额度后的按量单价（元/小时） */
  paidUnitPricePerHour: number
  /** 免费额度使用提醒阈值（百分比） */
  warnThresholdPercent: number
  /** 当前 STT 后端 */
  backend: 'filetrans' | 'flash'
}
