// shared/schemas/helpers.ts
// schema 类型推导辅助工具（仅导出类型，import type 零运行时产物）。
//
// 请求参数类型从 zod schema 推导（单一真相源），仅两种推导规则：
// - JSON body（POST/PUT，无 coerce）→ 直接 `z.input<typeof S>`（input === output，必填保必填）
// - query 参数（GET，含 z.coerce + .default）→ `QueryInput<typeof S>`（见下）
//
// 为何 query 不用 z.input：query 字段用 z.coerce（URL 字符串 → number），zod 对 coerce 字段的
// input 推导为 `unknown`，对前端拼参无类型意义；且 .default 使 z.output 字段变必填，与前端
// 「可选不带默认值」的拼参语义不符。故取 output（coerce 后类型正确）的全可选版。
// 后端 safeParse().data 仍是 z.output（defaults 已填充），与此类型正交。
//
// 例外：含 .transform 且改变 wire 格式的 query（如逗号串 → number[]），前端发原始值，
// 用 `z.input<typeof S>`（见 recordStatusQuerySchema 的 ids）。
import type { z } from 'zod'

/**
 * GET query 参数类型：schema 含 z.coerce/.default，z.input 会退化为 unknown，
 * 故取 output（coerce 后类型正确）的全可选版，与手写 query interface「可选不带默认值」语义一致。
 */
export type QueryInput<S extends z.ZodTypeAny> = Partial<z.output<S>>
