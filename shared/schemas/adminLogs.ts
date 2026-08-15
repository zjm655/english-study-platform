// shared/schemas/adminLogs.ts
// 管理员日志管理 schema（api_call_log / cloud_service_call_log / admin_operation_log / review_access_log 四子页）。
import { z } from 'zod'
import { REVIEW_TARGET_TYPES, REVIEW_REASON_CATEGORIES } from '../utils/permission'
import type { QueryInput } from './helpers'

/** api_call_log 列表查询校验 */
export const adminApiCallLogListSchema = z.object({
  page: z.coerce.number().int().min(1, 'page 不能小于 1').optional().default(1),
  pageSize: z.coerce
    .number()
    .int()
    .min(1, 'pageSize 不能小于 1')
    .max(100, 'pageSize 不能大于 100')
    .optional()
    .default(20),
  method: z
    .enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH'], {
      message: 'method 必须为 GET/POST/PUT/DELETE/PATCH',
    })
    .optional(),
  statusCodeGroup: z
    .enum(['success', '4xx', '5xx'], { message: 'statusCodeGroup 必须为 success/4xx/5xx' })
    .optional(),
  businessCode: z.coerce
    .number()
    .int()
    .min(0, 'businessCode 不能小于 0')
    .max(599, 'businessCode 不能大于 599')
    .optional(),
  pathKeyword: z.string().max(100, '路径关键词不能超过 100 字').optional(),
  userId: z.coerce.number().int().min(1, 'userId 不能小于 1').optional(),
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式必须为 YYYY-MM-DD')
    .optional(),
  endDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式必须为 YYYY-MM-DD')
    .optional(),
})

/** cloud_service_call_log 列表查询校验 */
export const adminCloudServiceLogListSchema = z.object({
  page: z.coerce.number().int().min(1, 'page 不能小于 1').optional().default(1),
  pageSize: z.coerce
    .number()
    .int()
    .min(1, 'pageSize 不能小于 1')
    .max(100, 'pageSize 不能大于 100')
    .optional()
    .default(20),
  service: z
    .enum(['deepseek', 'tts', 'oss', 'nls', 'bss', 'edu'], {
      message: 'service 必须为 deepseek/tts/oss/nls/bss/edu',
    })
    .optional(),
  success: z.coerce
    .number()
    .refine((v) => v === 0 || v === 1, 'success 必须为 0 或 1')
    .optional(),
  operationKeyword: z.string().max(50, '操作关键词不能超过 50 字').optional(),
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式必须为 YYYY-MM-DD')
    .optional(),
  endDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式必须为 YYYY-MM-DD')
    .optional(),
})

/** admin_operation_log 列表查询校验（V2，含日期范围，给 /api/admin/logs/operation 用） */
export const adminOperationLogListSchemaV2 = z.object({
  page: z.coerce.number().int().min(1, 'page 不能小于 1').optional().default(1),
  pageSize: z.coerce
    .number()
    .int()
    .min(1, 'pageSize 不能小于 1')
    .max(100, 'pageSize 不能大于 100')
    .optional()
    .default(20),
  action: z.string().max(50, '操作类型不能超过 50 字').optional(),
  keyword: z.string().max(50, '搜索关键词不能超过 50 字').optional(),
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式必须为 YYYY-MM-DD')
    .optional(),
  endDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式必须为 YYYY-MM-DD')
    .optional(),
})

/** review_access_log 列表查询校验（审核留痕子页，枚举复用 shared 常量防漂移） */
export const reviewAccessLogListSchema = z.object({
  page: z.coerce.number().int().min(1, 'page 不能小于 1').optional().default(1),
  pageSize: z.coerce
    .number()
    .int()
    .min(1, 'pageSize 不能小于 1')
    .max(100, 'pageSize 不能大于 100')
    .optional()
    .default(20),
  targetType: z
    .enum(REVIEW_TARGET_TYPES, {
      message: `targetType 必须为 ${REVIEW_TARGET_TYPES.join('/')}`,
    })
    .optional(),
  reasonCategory: z
    .enum(REVIEW_REASON_CATEGORIES, {
      message: 'reasonCategory 不在白名单内',
    })
    .optional(),
  keyword: z.string().max(100, '搜索关键词不能超过 100 字').optional(),
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式必须为 YYYY-MM-DD')
    .optional(),
  endDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式必须为 YYYY-MM-DD')
    .optional(),
})

// ============== 请求参数类型（推导自 schema，供 .d.ts re-export） ==============

/** api_call_log 列表查询参数（从 schema 推导，method/statusCodeGroup 收紧为枚举） */
export type ApiCallLogListQuery = QueryInput<typeof adminApiCallLogListSchema>

/** cloud_service_call_log 列表查询参数（从 schema 推导，service 收紧为枚举） */
export type CloudServiceLogListQuery = QueryInput<typeof adminCloudServiceLogListSchema>

/** admin_operation_log 列表查询参数 V2（从 schema 推导，全可选） */
export type OperationLogListQueryV2 = QueryInput<typeof adminOperationLogListSchemaV2>

/** review_access_log 列表查询参数（从 schema 推导，targetType/reasonCategory 收紧为枚举） */
export type ReviewAccessLogListQuery = QueryInput<typeof reviewAccessLogListSchema>
