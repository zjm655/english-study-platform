// shared/schemas/recording.ts
// 录音相关请求校验（analyze-fail 失败原因结构化上报，P2-A）。
import { z } from 'zod'

/** analyze-fail 请求体：评测失败原因（SDK 结构化上报；无 body 兼容旧调用） */
export const analyzeFailSchema = z.object({
  errorCode: z.string().max(50, 'errorCode 不能超过 50 字').optional(),
  errorMessage: z.string().max(500, 'errorMessage 不能超过 500 字').optional(),
})

export type AnalyzeFailInput = z.input<typeof analyzeFailSchema>
