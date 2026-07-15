// server/utils/validate.ts
import { z } from 'zod'


// 登陆校验
export const loginSchema = z.object({
  account: z
    .string()
    .min(8, '账号长度不能少于8位')
    .max(20, '账号长度不能超过20位')
    .regex(/^\d+$/, '账号必须是纯数字'),
  password: z
    .string()
    .min(8, '密码长度不能少于8位')
    .max(25, '密码长度不能超过25位')
    .refine(
      (val) => {
        let categories = 0
        if (/[a-zA-Z]/.test(val)) categories++     // 包含字母
        if (/\d/.test(val)) categories++           // 包含数字
        if (/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?`~]/.test(val)) categories++ // 包含特殊符号
        return categories >= 2
      },
      '密码必须包含数字、字母、特殊符号中的至少两类'
    )
})

// 注册校验
export const registerSchema = z.object({
  nickname: z.string().max(25, '昵称最多25个字符').optional().or(z.literal('')),
  account: z
    .string()
    .min(8, '账号长度不能少于8位')
    .max(20, '账号长度不能超过20位')
    .regex(/^\d+$/, '账号必须是纯数字'),
  email: z.string().email('邮箱格式不正确').optional().or(z.literal('')),
  password1: z
    .string()
    .min(8, '密码长度不能少于8位')
    .max(25, '密码长度不能超过25位')
    .refine(
      (val) => {
        let categories = 0
        if (/[a-zA-Z]/.test(val)) categories++     // 包含字母
        if (/\d/.test(val)) categories++           // 包含数字
        if (/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?`~]/.test(val)) categories++ // 包含特殊符号
        return categories >= 2
      },
      '密码必须包含数字、字母、特殊符号中的至少两类'
    ),
  password2: z
    .string()
    .min(8, '密码长度不能少于8位')
    .max(25, '密码长度不能超过25位')
}).refine((data) => data.password1 === data.password2, {
  message: '两次密码输入不一致',
  path: ['password2']
})

// 学习时长上报校验
export const studyTimeSchema = z.object({
  studySeconds: z
    .number()
    .min(0, '学习时长不能为负数')
    .max(3600, '单次上报时长不能超过1小时')
})

// 学习进度更新校验
export const progressSchema = z.object({
  segmentId: z.number().int().positive('segmentId 必须为正整数'),
  phase: z.number().int().min(1, 'phase 必须为 1-4').max(4, 'phase 必须为 1-4'),
  done: z.boolean(),
  score: z.number().min(0, '分数不能为负数').max(100, '分数不能超过100').optional()
}).refine(
  (data) => {
    // phase 3/4 完成时必须提供 score
    if ((data.phase === 3 || data.phase === 4) && data.done) {
      return data.score !== undefined
    }
    return true
  },
  { message: 'phase 3/4 完成时需要提供 score', path: ['score'] }
)

// ============== 通用工具 ==============

export function validateError(message: string, code=400) {
  return { code, message, data: null }
}

export function validateSuccess<T>(data: T, message = '成功', code=200) {
  return { code, message, data }
}