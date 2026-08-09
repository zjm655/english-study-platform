// shared/schemas/user.ts
// 用户端认证与学习行为 schema（登录/注册/资料/密码/学习时长/进度/录音上传/收藏）。
import { z } from 'zod'
import { passwordSchema } from './common'

// 登陆校验
export const loginSchema = z.object({
  account: z
    .string()
    .min(8, '账号长度不能少于8位')
    .max(20, '账号长度不能超过20位')
    .regex(/^\d+$/, '账号必须是纯数字'),
  password: passwordSchema,
  // 登录连错达阈值后必填（handler 内条件强制），常态可选，不影响正常登录
  captchaToken: z.string().optional(),
  captchaCode: z.string().optional(),
})

// 注册校验
export const registerSchema = z
  .object({
    nickname: z.string().max(25, '昵称最多25个字符').optional().or(z.literal('')),
    account: z
      .string()
      .min(8, '账号长度不能少于8位')
      .max(20, '账号长度不能超过20位')
      .regex(/^\d+$/, '账号必须是纯数字'),
    email: z.string().email('邮箱格式不正确').optional().or(z.literal('')),
    password1: passwordSchema,
    password2: z.string().min(8, '密码长度不能少于8位').max(25, '密码长度不能超过25位'),
    captchaToken: z.string().min(1, '请输入图形验证码'),
    captchaCode: z.string().min(1, '请输入图形验证码'),
  })
  .refine((data) => data.password1 === data.password2, {
    message: '两次密码输入不一致',
    path: ['password2'],
  })

/** 用户修改昵称校验（trim 后 1-25 字，max 与注册昵称规则对齐） */
export const userProfileUpdateSchema = z.object({
  nickname: z.string().trim().min(1, '昵称不能为空').max(25, '昵称最多25个字符'),
})

/** 用户修改密码校验（新密码走共享密码规则） */
export const passwordChangeSchema = z
  .object({
    oldPassword: z.string().min(1, '请输入旧密码'),
    newPassword: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: '两次密码输入不一致',
    path: ['confirmPassword'],
  })
  .refine((data) => data.oldPassword !== data.newPassword, {
    message: '新密码不能与旧密码相同',
    path: ['newPassword'],
  })

// 学习时长上报校验
export const studyTimeSchema = z.object({
  studySeconds: z.number().min(0, '学习时长不能为负数').max(3600, '单次上报时长不能超过1小时'),
})

// 学习进度更新校验
export const progressSchema = z
  .object({
    segmentId: z.number().int().positive('segmentId 必须为正整数'),
    phase: z.number().int().min(1, 'phase 必须为 1-4').max(4, 'phase 必须为 1-4'),
    done: z.boolean(),
    score: z.number().min(0, '分数不能为负数').max(100, '分数不能超过100').optional(),
  })
  .refine(
    (data) => {
      // phase 3/4 完成时必须提供 score
      if ((data.phase === 3 || data.phase === 4) && data.done) {
        return data.score !== undefined
      }
      return true
    },
    { message: 'phase 3/4 完成时需要提供 score', path: ['score'] },
  )

// 录音上传校验
export const uploadRecordingSchema = z.object({
  segmentId: z.number().int().positive('segmentId 必须为正整数'),
  phase: z
    .number()
    .int()
    .refine((v) => v === 3 || v === 4, 'phase 必须为 3 或 4'),
  duration: z.number().min(0.1, '录音时长过短').max(600, '录音时长不能超过10分钟'),
})

// 单词收藏校验
export const favWordSchema = z.object({
  vocabularyId: z.number().int().positive('vocabularyId 必须为正整数'),
})

// 片段收藏校验
export const favSegmentSchema = z.object({
  segmentId: z.number().int().positive('segmentId 必须为正整数'),
})

// ============== 请求参数类型（z.input 推导，供 .d.ts re-export） ==============
/** 登录入参（JSON body，z.input；captchaToken/captchaCode 连错达阈值后必填） */
export type LoginPayload = z.input<typeof loginSchema>

/** 注册入参（JSON body，z.input；跨字段 refine 校验两次密码一致，不改变 input 类型） */
export type RegisterPayload = z.input<typeof registerSchema>

/** 编辑资料入参（昵称 1-25 字，z.input） */
export type UserProfileUpdatePayload = z.input<typeof userProfileUpdateSchema>

/** 修改密码入参（成功后后端会清除 token cookie，z.input；refine 校验新旧不同/两次一致） */
export type PasswordChangePayload = z.input<typeof passwordChangeSchema>

/** 学习时长上报入参（z.input） */
export type StudyTimePayload = z.input<typeof studyTimeSchema>
