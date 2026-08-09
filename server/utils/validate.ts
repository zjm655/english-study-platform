// server/utils/validate.ts
// 服务端响应构造工具。请求参数 schema 的单一真相源在 shared/schemas/（见 shared/types/ 的推导类型），
// 消费方请显式 `import { xxxSchema } from '#shared/schemas/xxx'`（本文件不再 re-export，避免 unimport
// 无法解析 #shared 别名导致 typecheck 警告、以及类型经本文件泄漏破坏单一路径）。
import type { ResPayload } from '#shared/types/request'

export function validateError(message: string, code: number = 400): ResPayload<never> {
  return { code, message, data: undefined as never }
}

export function validateSuccess<T>(data: T, message = '成功', code = 200) {
  return { code, message, data }
}
