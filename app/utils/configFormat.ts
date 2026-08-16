// app/utils/configFormat.ts
// 系统配置页通用展示格式化工具（纯函数，auto-import）

/** 时间窗口单位选项（秒） */
export const UNIT_OPTIONS = [
  { label: '分钟', value: 60 },
  { label: '小时', value: 3600 },
  { label: '天', value: 86400 },
  { label: '周', value: 604800 },
]

/** 秒 → { val, unit }：从大到小找第一个整除单位，否则 fallback 分钟 */
export function secondsToUnit(sec: number): { val: number; unit: number } {
  for (const u of [...UNIT_OPTIONS].reverse()) {
    if (sec >= u.value && sec % u.value === 0) return { val: sec / u.value, unit: u.value }
  }
  return { val: Math.round(sec / 60), unit: 60 }
}

/** 字节 → MB 提示文案（整数直显，非整数保留 1 位小数） */
export function bytesToMB(bytes: number): string {
  const mb = bytes / (1024 * 1024)
  return `${Number.isInteger(mb) ? mb : mb.toFixed(1)} MB`
}

/** 秒 → 分钟展示文案 */
export function secondsToMinText(sec: number): string {
  const min = sec / 60
  return `${Number.isInteger(min) ? min : min.toFixed(1)} 分钟`
}
