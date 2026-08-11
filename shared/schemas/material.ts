// shared/schemas/material.ts
// 材料上传与记录 schema（用户/管理员上传、记录更新、状态批量查询、复习列表）。
import { z } from 'zod'
import { ALLOWED_VOICES } from './common'

/** 标题生成方式：ai=AI生成(失败截取前50字符) / manual=用户填写 / filename=文件名 / inline=正文#首行 */
export const TITLE_MODES = ['ai', 'manual', 'filename', 'inline'] as const

// 材料上传校验（普通用户）
export const uploadMaterialSchema = z.object({
  textContent: z
    .string()
    .min(10, '材料文本不能少于10个字符')
    .max(5000, '材料文本不能超过5000个字符'),
  isPublic: z.coerce.number().refine((v) => v === 0 || v === 1, 'isPublic 必须为 0 或 1'),
  voice: z.enum(ALLOWED_VOICES).optional().default('en-US-AriaNeural'),
  titleMode: z.enum(TITLE_MODES).optional().default('ai'),
})

// 材料上传校验（管理员，额外要求 unitId；允许 0=自定义单元）
export const uploadMaterialAdminSchema = uploadMaterialSchema.extend({
  unitId: z.number().int().min(0, 'unitId 不能为负数'),
})

// 管理员批量上传通用参数校验
export const adminUploadSchema = z.object({
  mode: z.enum(['single', 'batch']),
  // multipart 中 unitId 为字符串，必须 z.coerce（否则 z.number() 拒字符串，接口恒 400）
  unitId: z.coerce.number().int().min(0, 'unitId 不能为负数'),
  voice: z.enum(ALLOWED_VOICES).optional().default('en-US-AriaNeural'),
  // 缺失时 formData.get 返回 null；nullish 让 null/undefined 绕过 coerce，transform 兼底为 1（默认公开）
  isPublic: z.coerce
    .number()
    .refine((v) => v === 0 || v === 1, 'isPublic 必须为 0 或 1')
    .nullish()
    .transform((v) => v ?? 1),
  // NLS 语音校对开关（仅 single + 音频场景生效；batch 无音频恒为 0）：null/undefined 兼底 0（默认关闭）
  nlsCheck: z.coerce
    .number()
    .refine((v) => v === 0 || v === 1, 'nlsCheck 必须为 0 或 1')
    .nullish()
    .transform((v) => v ?? 0),
  // 缺失时 formData.get 返回 null；nullish 让 null/undefined 绕过，transform 兼底 'ai'（默认 AI 生成）
  titleMode: z
    .enum(TITLE_MODES)
    .nullish()
    .transform((v) => v ?? 'ai'),
})

// 材料上传记录更新校验（JSON body，无需 coerce）
export const updateMaterialRecordSchema = z.object({
  isPublic: z.number().refine((v) => v === 0 || v === 1, 'isPublic 必须为 0 或 1'),
})

// 材料上传记录状态批量查询（轮询轻接口）：ids 为逗号分隔正整数串，去重后 1~50 个
export const recordStatusQuerySchema = z.object({
  ids: z
    .string()
    .min(1, 'ids 不能为空')
    .transform((s) => [...new Set(s.split(','))].map((v) => Number(v.trim())))
    .refine((arr) => arr.length >= 1 && arr.length <= 50, 'ids 数量需在 1~50 之间')
    .refine((arr) => arr.every((n) => Number.isInteger(n) && n > 0), 'ids 必须为逗号分隔的正整数'),
})

/** 复习列表查询参数校验（limit 在 API 层自行设置默认值） */
export const reviewQuerySchema = z.object({
  limit: z.coerce.number().min(1, 'limit 不能小于 1').max(50, 'limit 不能大于 50').optional(),
  offset: z.coerce.number().int().min(0, 'offset 不能小于 0').optional().default(0),
  keyword: z.string().max(100, '关键词不能超过 100 字').optional(),
})

// ============== 请求参数类型（推导自 schema，供 .d.ts re-export） ==============

/** 标题生成方式：ai=AI生成 / manual=用户填写 / filename=文件名 / inline=正文#首行 */
export type TitleMode = (typeof TITLE_MODES)[number]

/** 更新材料记录参数（JSON body，z.input） */
export type UpdateMaterialRecordPayload = z.input<typeof updateMaterialRecordSchema>
