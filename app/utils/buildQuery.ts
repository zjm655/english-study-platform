// app/utils/buildQuery.ts

/** buildQuery 可接受的参数值类型 */
export type QueryValue = string | number | boolean | undefined | null

/**
 * 将查询参数对象拼接为 URL query string（含前导 `?`，无有效参数时返回空串）。
 *
 * 收敛 app/api 层散落的手搓 `URLSearchParams` 逻辑，行为对齐既有约定：
 * - 跳过 `undefined` / `null` / 空字符串（等价于原先的 `if (options.xxx)` 与 `!== undefined/null` 守卫）；
 * - 数字 `0`、布尔 `false` 视为有效值，仍会附加（对齐 `success=0`、`unitId=0` 等场景）；
 * - 其余值统一 `String()` 序列化。
 */
export function buildQuery(params: Record<string, QueryValue>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue
    search.append(key, String(value))
  }
  const query = search.toString()
  return query ? `?${query}` : ''
}
