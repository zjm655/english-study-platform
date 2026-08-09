// shared/schemas/adminMaterialRecord.ts
// 管理员材料上传记录管理 schema（列表查询、重处理）。
import { z } from 'zod'
import type { QueryInput } from './helpers'

/** 管理员上传记录列表查询参数校验 */
export const adminMaterialRecordListSchema = z.object({
  page: z.coerce.number().int().min(1, 'page 不能小于 1').optional().default(1),
  pageSize: z.coerce
    .number()
    .int()
    .min(1, 'pageSize 不能小于 1')
    .max(50, 'pageSize 不能大于 50')
    .optional()
    .default(10),
  status: z
    .enum(['queued', 'processing', 'success', 'failed'], {
      message: 'status 必须为 queued/processing/success/failed',
    })
    .optional(),
  source: z
    .enum(['all', 'user', 'admin'], { message: 'source 必须为 all/user/admin' })
    .optional()
    .default('all'),
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式必须为 YYYY-MM-DD')
    .optional(),
  endDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式必须为 YYYY-MM-DD')
    .optional(),
})

/** 管理员重处理上传记录参数校验 */
export const adminMaterialRecordReprocessSchema = z.object({
  unitId: z.number().int().min(0, 'unitId 不能为负数'),
})

// ============== 请求参数类型（推导自 schema，供 .d.ts re-export） ==============

/** 上传记录列表查询参数（query string，后端 zod coerce；从 schema 推导，全可选） */
export type AdminMaterialRecordListQuery = QueryInput<typeof adminMaterialRecordListSchema>

/** 重处理请求参数（z.input） */
export type AdminMaterialRecordReprocessPayload = z.input<typeof adminMaterialRecordReprocessSchema>
