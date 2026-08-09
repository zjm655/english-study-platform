// shared/schemas/adminOperationLog.ts
// 管理员操作日志 schema（全局操作日志列表、用户维度操作日志）。
import { z } from 'zod'
import type { QueryInput } from './helpers'

/** 管理员操作日志列表查询校验 */
export const adminOperationLogListSchema = z.object({
  page: z.coerce.number().int().min(1, 'page 不能小于 1').optional().default(1),
  pageSize: z.coerce
    .number()
    .int()
    .min(1, 'pageSize 不能小于 1')
    .max(50, 'pageSize 不能大于 50')
    .optional()
    .default(10),
  action: z.string().max(50, '操作类型不能超过 50 字').optional(),
  keyword: z.string().max(50, '搜索关键词不能超过 50 字').optional(),
})

/** 用户维度操作日志校验（与全局共用，仅少了 action/keyword） */
export const adminUserLogsSchema = z.object({
  page: z.coerce.number().int().min(1, 'page 不能小于 1').optional().default(1),
  pageSize: z.coerce
    .number()
    .int()
    .min(1, 'pageSize 不能小于 1')
    .max(50, 'pageSize 不能大于 50')
    .optional()
    .default(10),
})

// ============== 请求参数类型（推导自 schema，供 .d.ts re-export） ==============

/** 操作日志列表查询参数（从 schema 推导，全可选） */
export type AdminOperationLogListQuery = QueryInput<typeof adminOperationLogListSchema>
