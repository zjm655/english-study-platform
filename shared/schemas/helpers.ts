// shared/schemas/helpers.ts
// schema 类型推导辅助工具（仅导出类型，import type 零运行时产物）。
//
// 背景：请求参数类型从 zod schema 推导（单一真相源），但 z.coerce/.default/.transform
// 会使 z.input 与 z.output 分叉，需按场景选择正确的推导方向：
// - query 参数（GET，含 z.coerce + .default）→ QueryInput（output 的全可选版）
// - JSON body（POST/PUT，无 coerce）→ 直接 z.input
// - 含 .transform（input≠output）→ z.input（前端发原始值）
import type { z } from 'zod'

/**
 * GET query 参数类型：schema 含 z.coerce/.default，z.input 会退化为 unknown，
 * 故取 output（coerce 后类型正确）的全可选版，与手写 query interface「可选不带默认值」语义一致。
 * 后端 safeParse().data 仍是 z.output（defaults 已填充），与此类型正交。
 */
export type QueryInput<S extends z.ZodTypeAny> = Partial<z.output<S>>
