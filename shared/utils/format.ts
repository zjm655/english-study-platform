// shared/utils/format.ts
// 格式化工具函数

/**
 * 将秒数格式化为 MM:SS 字符串
 * @param seconds 秒数（null 或 undefined 返回 "00:00"）
 */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return '00:00'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}
