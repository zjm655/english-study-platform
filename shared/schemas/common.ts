// shared/schemas/common.ts
// 跨模块复用的 schema 构件（密码规则、音色白名单）。
// 单一真相源：请求参数 schema 从 server/utils/validate.ts 迁入 shared/schemas/，
// 由 validate.ts re-export，前端可 import type 推导请求参数类型（零运行时）。
import { z } from 'zod'

/** 共享密码规则：8-25 位 + 必须包含数字、字母、特殊符号中的至少两类（登录/注册/修改密码复用） */
export const passwordSchema = z
  .string()
  .min(8, '密码长度不能少于8位')
  .max(25, '密码长度不能超过25位')
  .refine((val) => {
    let categories = 0
    if (/[a-zA-Z]/.test(val)) categories++ // 包含字母
    if (/\d/.test(val)) categories++ // 包含数字
    if (/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?`~]/.test(val)) categories++ // 包含特殊符号
    return categories >= 2
  }, '密码必须包含数字、字母、特殊符号中的至少两类')

/** 支持的朗读音色白名单 */
export const ALLOWED_VOICES = [
  'en-US-AriaNeural',
  'en-US-GuyNeural',
  'en-US-JennyNeural',
  'en-GB-SoniaNeural',
  'en-GB-RyanNeural',
] as const
