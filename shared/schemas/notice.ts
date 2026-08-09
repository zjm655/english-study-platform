// shared/schemas/notice.ts
// 公告模块 schema（用户端列表、管理端列表/创建/更新）。
import { z } from 'zod'

/**
 * datetime 字符串校验：兼容 el-date-picker 的 'YYYY-MM-DD HH:mm:ss' 与 ISO 格式。
 * 项目既有 date 校验用正则（YYYY-MM-DD），但公告需精确到时分秒且前端控件格式多样，
 * 故改用「new Date 可解析」的宽松校验，避免前端格式与固定正则对不上导致恒 400。
 */
const datetimeString = z
  .string()
  .refine((v) => !Number.isNaN(new Date(v).getTime()), '时间格式不正确')

/** 两者都有时校验 publishAt < expireAt（跨字段 refine 复用） */
function publishBeforeExpire(d: { publishAt?: string | null; expireAt?: string | null }): boolean {
  if (d.publishAt && d.expireAt) return new Date(d.publishAt) < new Date(d.expireAt)
  return true
}

/** 用户端公告列表查询校验（query string，必须 z.coerce） */
export const noticeListSchema = z.object({
  page: z.coerce.number().int().min(1, 'page 不能小于 1').optional().default(1),
  pageSize: z.coerce
    .number()
    .int()
    .min(1, 'pageSize 不能小于 1')
    .max(50, 'pageSize 不能大于 50')
    .optional()
    .default(10),
})

/** 管理端公告列表查询校验（含状态筛选 + 标题关键词） */
export const adminNoticeListSchema = z.object({
  page: z.coerce.number().int().min(1, 'page 不能小于 1').optional().default(1),
  pageSize: z.coerce
    .number()
    .int()
    .min(1, 'pageSize 不能小于 1')
    .max(50, 'pageSize 不能大于 50')
    .optional()
    .default(10),
  status: z
    .enum(['all', 'draft', 'published', 'revoked'], {
      message: 'status 必须为 all/draft/published/revoked',
    })
    .optional()
    .default('all'),
  keyword: z.string().max(100, '搜索关键词不能超过 100 个字符').optional(),
})

/** 管理端公告创建校验（status 仅 draft/published；refine publishAt<expireAt） */
export const adminNoticeCreateSchema = z
  .object({
    title: z.string().min(1, '标题不能为空').max(200, '标题不能超过 200 个字符'),
    content: z.string().min(1, '正文不能为空').max(5000, '正文不能超过 5000 个字符'),
    publishAt: datetimeString.nullish(),
    expireAt: datetimeString.nullish(),
    isPinned: z.boolean().optional().default(false),
    status: z
      .enum(['draft', 'published'], { message: 'status 必须为 draft/published' })
      .optional()
      .default('draft'),
  })
  .refine(publishBeforeExpire, { message: '过期时间必须晚于发布时间', path: ['expireAt'] })

/** 管理端公告更新校验（全 optional，status 含 revoked；refine publishAt<expireAt） */
export const adminNoticeUpdateSchema = z
  .object({
    title: z.string().min(1, '标题不能为空').max(200, '标题不能超过 200 个字符').optional(),
    content: z.string().min(1, '正文不能为空').max(5000, '正文不能超过 5000 个字符').optional(),
    publishAt: datetimeString.nullish(),
    expireAt: datetimeString.nullish(),
    isPinned: z.boolean().optional(),
    status: z
      .enum(['draft', 'published', 'revoked'], {
        message: 'status 必须为 draft/published/revoked',
      })
      .optional(),
  })
  .refine(publishBeforeExpire, { message: '过期时间必须晚于发布时间', path: ['expireAt'] })

// ============== 请求参数类型（推导自 schema，供 .d.ts re-export） ==============

/** 公告创建载荷（管理端；z.input，.default 不影响 input 可选性；refine 校验 publishAt<expireAt） */
export type NoticeCreatePayload = z.input<typeof adminNoticeCreateSchema>

/** 公告更新载荷（管理端，全字段可选，受状态转移规则约束；z.input） */
export type NoticeUpdatePayload = z.input<typeof adminNoticeUpdateSchema>
