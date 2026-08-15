// shared/schemas/clientError.ts
// 前端错误上报请求校验（P1-E）：message 必填截断 500，stack/url 可选截断 4000/500。
import { z } from 'zod'

export const clientErrorReportSchema = z.object({
  message: z.string().min(1, 'message 不能为空').max(500, 'message 不能超过 500 字'),
  stack: z.string().max(4000, 'stack 不能超过 4000 字').optional(),
  url: z.string().max(500, 'url 不能超过 500 字').optional(),
})

export type ClientErrorReportInput = z.input<typeof clientErrorReportSchema>
