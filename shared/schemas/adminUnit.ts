// shared/schemas/adminUnit.ts
// 管理员单元管理 schema（列表查询、保存）。
import { z } from 'zod'
import type { QueryInput } from './helpers'

/** 管理员单元列表查询参数校验（query string 均为字符串，必须 z.coerce） */
export const adminUnitListSchema = z.object({
  page: z.coerce.number().int().min(1, 'page 不能小于 1').optional().default(1),
  pageSize: z.coerce
    .number()
    .int()
    .min(1, 'pageSize 不能小于 1')
    .max(50, 'pageSize 不能大于 50')
    .optional()
    .default(10),
  // 0 = 用户自定义材料单元，是合法筛选值；不设上限，等级可自由扩展
  level: z.coerce.number().int().min(0, 'level 不能为负数').optional(),
  keyword: z.string().max(100, '搜索关键词不能超过 100 个字符').optional(),
})

/** 管理员单元保存校验（新建与编辑共用；level 为自由数字等级，数字越大难度越高，0 保留给自定义单元） */
export const adminUnitSaveSchema = z.object({
  title: z.string().min(1, '标题不能为空').max(100, '标题不能超过 100 个字符'),
  description: z.string().max(500, '简介不能超过 500 个字符').nullish(),
  level: z.number().int().min(1, 'level 必须 ≥1（0 保留给自定义单元）'),
  sortOrder: z.number().int().min(0, 'sortOrder 不能为负数'),
})

// ============== 请求参数类型（推导自 schema，供 .d.ts re-export） ==============

/** 单元列表查询参数（query string，后端 zod coerce；从 schema 推导，全可选） */
export type AdminUnitListQuery = QueryInput<typeof adminUnitListSchema>

/** 单元保存载荷（新建与编辑共用；level 为自由数字等级 ≥1，0 保留给自定义单元；z.input） */
export type AdminUnitSavePayload = z.input<typeof adminUnitSaveSchema>
