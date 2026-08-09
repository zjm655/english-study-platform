// shared/schemas/adminStats.ts
// 运营统计 schema（查询参数）。
import { z } from 'zod'
import type { QueryInput } from './helpers'

/** 运营统计查询参数校验（days: 时间范围天数，默认 7，最大 90） */
export const adminStatsQuerySchema = z.object({
  days: z.coerce
    .number()
    .int()
    .min(1, 'days 不能小于 1')
    .max(90, 'days 不能大于 90')
    .optional()
    .default(7),
})

// ============== 请求参数类型（推导自 schema，供 .d.ts re-export） ==============

/** 查询参数（query string，后端 zod coerce；从 schema 推导，全可选） */
export type AdminStatsQuery = QueryInput<typeof adminStatsQuerySchema>
