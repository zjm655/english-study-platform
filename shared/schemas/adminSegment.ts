// shared/schemas/adminSegment.ts
// 管理员材料管理 schema（列表查询、编辑）。
import { z } from 'zod'
import type { QueryInput } from './helpers'

/** 管理员材料列表查询参数校验（query string 均为字符串，必须 z.coerce） */
export const adminSegmentListSchema = z.object({
  page: z.coerce.number().int().min(1, 'page 不能小于 1').optional().default(1),
  pageSize: z.coerce
    .number()
    .int()
    .min(1, 'pageSize 不能小于 1')
    .max(50, 'pageSize 不能大于 50')
    .optional()
    .default(10),
  // 0 = 用户自定义材料单元，是合法值，故 min(0)
  unitId: z.coerce.number().int().min(0, 'unitId 不能为负数').optional(),
  isPublic: z.coerce
    .number()
    .refine((v) => v === 0 || v === 1, 'isPublic 必须为 0 或 1')
    .optional(),
  keyword: z.string().max(100, '搜索关键词不能超过 100 个字符').optional(),
})

/** 管理员材料编辑校验（仅文本字段；JSON body 无需 coerce） */
export const adminSegmentUpdateSchema = z.object({
  title: z.string().min(1, '标题不能为空').max(100, '标题不能超过 100 个字符'),
  textContent: z
    .string()
    .min(10, '材料文本不能少于 10 个字符')
    .max(5000, '材料文本不能超过 5000 个字符'),
  translation: z.string().max(5000, '翻译不能超过 5000 个字符').nullish(),
  questions: z
    .array(
      z.object({
        question: z.string().min(1, '题干不能为空'),
        options: z.array(z.string()).min(1, '选项不能为空'),
        answer: z.string().min(1, '答案不能为空'),
      }),
    )
    .nullish(),
  vocabulary: z
    .array(
      z.object({
        id: z.number().int().positive().optional(),
        word: z.string().min(1, '单词不能为空').max(100, '单词不能超过 100 个字符'),
        forms: z.string().max(200).nullish(),
        phonetic: z.string().max(100).nullish(),
        meaning: z.string().min(1, '释义不能为空').max(500, '释义不能超过 500 个字符'),
        exampleSentence: z.string().max(500).nullish(),
        exampleTranslation: z.string().max(500).nullish(),
      }),
    )
    .nullish(),
  isPublic: z
    .number()
    .refine((v) => v === 0 || v === 1, 'isPublic 必须为 0 或 1')
    .optional(),
  // 所属单元变更（可选；0=自定义单元合法；与受限材料 is_public 防绕过逻辑正交）
  unitId: z.number().int().min(0, 'unitId 不能为负数').optional(),
})

// ============== 请求参数类型（推导自 schema，供 .d.ts re-export） ==============

/** 材料列表查询参数（query string，后端 zod coerce；从 schema 推导，全可选） */
export type AdminSegmentListQuery = QueryInput<typeof adminSegmentListSchema>

/** 材料编辑载荷（仅文本字段，不触发 TTS/AI 再生成；z.input，questions/vocabulary 结构同 Question/AdminVocabEditItem） */
export type AdminSegmentUpdatePayload = z.input<typeof adminSegmentUpdateSchema>
