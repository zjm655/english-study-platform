// server/utils/validate.ts
// 服务端校验门面（barrel）：请求参数 schema 的单一真相源已迁入 shared/schemas/，
// 本文件 re-export 全部 schema（保持导出名与 Nitro auto-import 不变，87 处后端引用零改动），
// 并保留服务端专属的响应构造工具 validateSuccess/validateError（依赖 ResPayload，属响应层）。
//
// 前端请勿从本文件 import——请求参数类型请改用 shared/types/*.d.ts 中的推导类型别名
// （import type，零运行时），或直接 import type 自 shared/schemas/ 推导。
import type { ResPayload } from '#shared/types/request'

export * from '#shared/schemas/common'
export * from '#shared/schemas/user'
export * from '#shared/schemas/material'
export * from '#shared/schemas/adminSegment'
export * from '#shared/schemas/adminUnit'
export * from '#shared/schemas/adminUser'
export * from '#shared/schemas/adminOperationLog'
export * from '#shared/schemas/adminMaterialRecord'
export * from '#shared/schemas/adminStats'
export * from '#shared/schemas/adminLogs'
export * from '#shared/schemas/batch'
export * from '#shared/schemas/notice'

// ============== 通用工具（服务端响应层） ==============

export function validateError(message: string, code: number = 400): ResPayload<never> {
  return { code, message, data: undefined as never }
}

export function validateSuccess<T>(data: T, message = '成功', code = 200) {
  return { code, message, data }
}
