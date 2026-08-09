// shared/schemas/adminUser.ts
// 管理员用户管理 schema（列表查询、资料修改、封禁、角色变更、录音记录列表）。
import { z } from 'zod'
import type { QueryInput } from './helpers'

/** 管理员用户列表查询参数校验（query string 均为字符串，必须 z.coerce） */
export const adminUserListSchema = z.object({
  page: z.coerce.number().int().min(1, 'page 不能小于 1').optional().default(1),
  pageSize: z.coerce
    .number()
    .int()
    .min(1, 'pageSize 不能小于 1')
    .max(50, 'pageSize 不能大于 50')
    .optional()
    .default(10),
  keyword: z.string().max(50, '搜索关键词不能超过 50 个字符').optional(),
  state: z
    .enum(['everyone', 'all', 'normal', 'banned', 'deleted', 'guest'], {
      message: 'state 必须为 everyone/all/normal/banned/deleted/guest',
    })
    .optional()
    .default('all'),
})

/** 管理员修改用户资料校验（nickname/email/level；本次不含角色变更） */
export const adminUserUpdateSchema = z.object({
  nickname: z.string().max(50, '昵称不能超过 50 个字符').nullish(),
  email: z.string().email('邮箱格式不正确').max(255).nullish(),
  level: z.number().int().min(0, 'level 不能小于 0').max(3, 'level 不能大于 3').optional(),
})

/** 管理员封禁/解封校验 */
export const adminUserStatusSchema = z.object({
  status: z.number().refine((v) => v === 0 || v === 1, 'status 必须为 0 或 1'),
})

/** 管理员角色变更校验（仅普通用户↔管理员；超管唯一且不可经 API 分配） */
export const adminUserRoleSchema = z.object({
  role: z.coerce.number().refine((v) => v === 0 || v === 1, 'role 必须为 0 或 1'),
})

/** 管理员查看某用户录音记录列表查询参数校验 */
export const adminUserRecordingListSchema = z.object({
  page: z.coerce.number().int().min(1, 'page 不能小于 1').optional().default(1),
  pageSize: z.coerce
    .number()
    .int()
    .min(1, 'pageSize 不能小于 1')
    .max(50, 'pageSize 不能大于 50')
    .optional()
    .default(10),
  phase: z.coerce
    .number()
    .refine((v) => v === 3 || v === 4, { message: 'phase 必须为 3 或 4' })
    .optional(),
  unitId: z.coerce.number().int().min(1, 'unitId 必须为正整数').optional(),
  keyword: z.string().max(100, 'keyword 过长').optional(),
  scoreBand: z
    .enum(['all', 'high', 'mid', 'low'], { message: 'scoreBand 必须为 all/high/mid/low' })
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

// ============== 请求参数类型（推导自 schema，供 .d.ts re-export） ==============

/** 用户列表查询参数（query string，后端 zod coerce；从 schema 推导，全可选） */
export type AdminUserListQuery = QueryInput<typeof adminUserListSchema>

/** 资料修改载荷（nickname / email / level；本次不含角色变更；z.input） */
export type AdminUserUpdatePayload = z.input<typeof adminUserUpdateSchema>

/** 封禁/解封载荷（z.input） */
export type AdminUserStatusPayload = z.input<typeof adminUserStatusSchema>

/** 角色变更载荷（schema 含 z.coerce，input 退化为 unknown，故取 z.output） */
export type AdminUserRolePayload = z.output<typeof adminUserRoleSchema>

/** 用户录音记录列表查询参数（query string，后端 zod coerce；从 schema 推导，全可选） */
export type AdminUserRecordingListQuery = QueryInput<typeof adminUserRecordingListSchema>
