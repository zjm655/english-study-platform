// server/utils/validate.ts
import { z } from 'zod'
import type { ResPayload } from '#shared/types/request'

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
    .refine((val) => {
      let categories = 0
      if (/[a-zA-Z]/.test(val)) categories++ // 包含字母
      if (/\d/.test(val)) categories++ // 包含数字
      if (/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?`~]/.test(val)) categories++ // 包含特殊符号
      return categories >= 2
    }, '密码必须包含数字、字母、特殊符号中的至少两类'),
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
    password1: z
      .string()
      .min(8, '密码长度不能少于8位')
      .max(25, '密码长度不能超过25位')
      .refine((val) => {
        let categories = 0
        if (/[a-zA-Z]/.test(val)) categories++ // 包含字母
        if (/\d/.test(val)) categories++ // 包含数字
        if (/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?`~]/.test(val)) categories++ // 包含特殊符号
        return categories >= 2
      }, '密码必须包含数字、字母、特殊符号中的至少两类'),
    password2: z.string().min(8, '密码长度不能少于8位').max(25, '密码长度不能超过25位'),
  })
  .refine((data) => data.password1 === data.password2, {
    message: '两次密码输入不一致',
    path: ['password2'],
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

/** 支持的朗读音色白名单 */
export const ALLOWED_VOICES = [
  'en-US-AriaNeural',
  'en-US-GuyNeural',
  'en-US-JennyNeural',
  'en-GB-SoniaNeural',
  'en-GB-RyanNeural',
] as const

// 材料上传校验（普通用户）
export const uploadMaterialSchema = z.object({
  textContent: z
    .string()
    .min(10, '材料文本不能少于10个字符')
    .max(5000, '材料文本不能超过5000个字符'),
  isPublic: z.coerce.number().refine((v) => v === 0 || v === 1, 'isPublic 必须为 0 或 1'),
  voice: z.enum(ALLOWED_VOICES).optional().default('en-US-AriaNeural'),
})

// 材料上传校验（管理员，额外要求 unitId）
export const uploadMaterialAdminSchema = uploadMaterialSchema.extend({
  unitId: z.number().int().positive('unitId 必须为正整数'),
})

// 管理员批量上传通用参数校验
export const adminUploadSchema = z.object({
  mode: z.enum(['single', 'batch']),
  // multipart 中 unitId 为字符串，必须 z.coerce（否则 z.number() 拒字符串，接口恒 400）
  unitId: z.coerce.number().int().min(0, 'unitId 不能为负数'),
  voice: z.enum(ALLOWED_VOICES).optional().default('en-US-AriaNeural'),
  // 缺失时 formData.get 返回 null；nullish 让 null/undefined 绕过 coerce，transform 兼底为 1（默认公开）
  isPublic: z.coerce
    .number()
    .refine((v) => v === 0 || v === 1, 'isPublic 必须为 0 或 1')
    .nullish()
    .transform((v) => v ?? 1),
})

// 材料上传记录更新校验
export const updateMaterialRecordSchema = z.object({
  isPublic: z.coerce.number().refine((v) => v === 0 || v === 1, 'isPublic 必须为 0 或 1'),
})

/** 复习列表查询参数校验（limit 在 API 层自行设置默认值） */
export const reviewQuerySchema = z.object({
  limit: z.coerce.number().min(1, 'limit 不能小于 1').max(50, 'limit 不能大于 50').optional(),
  offset: z.coerce.number().int().min(0, 'offset 不能小于 0').optional().default(0),
  keyword: z.string().max(100, '关键词不能超过 100 字').optional(),
})

// ============== 管理员材料管理 ==============

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
})

// ============== 管理员用户管理 ==============

/** 管理员用户列表查询参数校验（query string 均为字符串，必须 z.coerce） */
export const adminUserListSchema = z.object({
  page: z.coerce.number().int().min(1, 'page 不能小于 1').optional().default(1),
  pageSize: z.coerce
    .number()
    .int()
    .min(1, 'pageSize 不能小于 1')
    .max(50, 'pageSize 不能大于 50')
    .optional()
    .default(10),
  keyword: z.string().max(50, '搜索关键词不能超过 50 个字符').optional(),
  state: z
    .enum(['all', 'normal', 'banned', 'deleted'], {
      message: 'state 必须为 all/normal/banned/deleted',
    })
    .optional()
    .default('all'),
})

/** 管理员修改用户资料校验（nickname/email/level；本次不含角色变更） */
export const adminUserUpdateSchema = z.object({
  nickname: z.string().max(50, '昵称不能超过 50 个字符').nullish(),
  email: z.string().email('邮箱格式不正确').max(255).nullish(),
  level: z.number().int().min(0, 'level 不能小于 0').max(3, 'level 不能大于 3').optional(),
})

/** 管理员封禁/解封校验 */
export const adminUserStatusSchema = z.object({
  status: z.number().refine((v) => v === 0 || v === 1, 'status 必须为 0 或 1'),
})

/** 管理员角色变更校验 */
export const adminUserRoleSchema = z.object({
  role: z.coerce.number().refine((v) => v === 0 || v === 1, 'role 必须为 0 或 1'),
})

/** 管理员操作日志列表查询校验 */
export const adminOperationLogListSchema = z.object({
  page: z.coerce.number().int().min(1, 'page 不能小于 1').optional().default(1),
  pageSize: z.coerce
    .number()
    .int()
    .min(1, 'pageSize 不能小于 1')
    .max(50, 'pageSize 不能大于 50')
    .optional()
    .default(10),
  action: z.string().max(50, '操作类型不能超过 50 字').optional(),
  keyword: z.string().max(50, '搜索关键词不能超过 50 字').optional(),
})

/** 用户维度操作日志校验（与全局共用，仅少了 action/keyword） */
export const adminUserLogsSchema = z.object({
  page: z.coerce.number().int().min(1, 'page 不能小于 1').optional().default(1),
  pageSize: z.coerce
    .number()
    .int()
    .min(1, 'pageSize 不能小于 1')
    .max(50, 'pageSize 不能大于 50')
    .optional()
    .default(10),
})

// ============== 管理员材料上传记录管理 ==============

/** 管理员上传记录列表查询参数校验 */
export const adminMaterialRecordListSchema = z.object({
  page: z.coerce.number().int().min(1, 'page 不能小于 1').optional().default(1),
  pageSize: z.coerce
    .number()
    .int()
    .min(1, 'pageSize 不能小于 1')
    .max(50, 'pageSize 不能大于 50')
    .optional()
    .default(10),
  status: z
    .enum(['processing', 'success', 'failed'], {
      message: 'status 必须为 processing/success/failed',
    })
    .optional(),
  source: z
    .enum(['all', 'user', 'admin'], { message: 'source 必须为 all/user/admin' })
    .optional()
    .default('all'),
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式必须为 YYYY-MM-DD')
    .optional(),
  endDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式必须为 YYYY-MM-DD')
    .optional(),
})

/** 管理员重处理上传记录参数校验 */
export const adminMaterialRecordReprocessSchema = z.object({
  unitId: z.number().int().min(0, 'unitId 不能为负数'),
})

/** 运营统计查询参数校验（days: 时间范围天数，默认 7，最大 90） */
export const adminStatsQuerySchema = z.object({
  days: z.coerce
    .number()
    .int()
    .min(1, 'days 不能小于 1')
    .max(90, 'days 不能大于 90')
    .optional()
    .default(7),
})

// ============== 通用工具 ==============

export function validateError(message: string, code: number = 400): ResPayload<never> {
  return { code, message, data: undefined as never }
}

export function validateSuccess<T>(data: T, message = '成功', code = 200) {
  return { code, message, data }
}
