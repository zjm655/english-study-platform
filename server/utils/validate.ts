// server/utils/validate.ts
import { z } from 'zod'
import type { ResPayload } from '#shared/types/request'
import { REVIEW_TARGET_TYPES, REVIEW_REASON_CATEGORIES } from '#shared/utils/permission'

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

// ============== 用户个人资料 ==============

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

// 材料上传校验（管理员，额外要求 unitId；允许 0=自定义单元）
export const uploadMaterialAdminSchema = uploadMaterialSchema.extend({
  unitId: z.number().int().min(0, 'unitId 不能为负数'),
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

// 材料上传记录状态批量查询（轮询轻接口）：ids 为逗号分隔正整数串，去重后 1~50 个
export const recordStatusQuerySchema = z.object({
  ids: z
    .string()
    .min(1, 'ids 不能为空')
    .transform((s) => [...new Set(s.split(','))].map((v) => Number(v.trim())))
    .refine((arr) => arr.length >= 1 && arr.length <= 50, 'ids 数量需在 1~50 之间')
    .refine((arr) => arr.every((n) => Number.isInteger(n) && n > 0), 'ids 必须为逗号分隔的正整数'),
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
  // 所属单元变更（可选；0=自定义单元合法；与受限材料 is_public 防绕过逻辑正交）
  unitId: z.number().int().min(0, 'unitId 不能为负数').optional(),
})

// ============== 管理员单元管理 ==============

/** 管理员单元列表查询参数校验（query string 均为字符串，必须 z.coerce） */
export const adminUnitListSchema = z.object({
  page: z.coerce.number().int().min(1, 'page 不能小于 1').optional().default(1),
  pageSize: z.coerce
    .number()
    .int()
    .min(1, 'pageSize 不能小于 1')
    .max(50, 'pageSize 不能大于 50')
    .optional()
    .default(10),
  // 0 = 用户自定义材料单元，是合法筛选值；不设上限，等级可自由扩展
  level: z.coerce.number().int().min(0, 'level 不能为负数').optional(),
  keyword: z.string().max(100, '搜索关键词不能超过 100 个字符').optional(),
})

/** 管理员单元保存校验（新建与编辑共用；level 为自由数字等级，数字越大难度越高，0 保留给自定义单元） */
export const adminUnitSaveSchema = z.object({
  title: z.string().min(1, '标题不能为空').max(100, '标题不能超过 100 个字符'),
  description: z.string().max(500, '简介不能超过 500 个字符').nullish(),
  level: z.number().int().min(1, 'level 必须 ≥1（0 保留给自定义单元）'),
  sortOrder: z.number().int().min(0, 'sortOrder 不能为负数'),
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
    .enum(['all', 'normal', 'banned', 'deleted', 'guest'], {
      message: 'state 必须为 all/normal/banned/deleted/guest',
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

/** 管理员角色变更校验（仅普通用户↔管理员；超管唯一且不可经 API 分配） */
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
    .enum(['queued', 'processing', 'success', 'failed'], {
      message: 'status 必须为 queued/processing/success/failed',
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

/** 管理员查看某用户录音记录列表查询参数校验 */
export const adminUserRecordingListSchema = z.object({
  page: z.coerce.number().int().min(1, 'page 不能小于 1').optional().default(1),
  pageSize: z.coerce
    .number()
    .int()
    .min(1, 'pageSize 不能小于 1')
    .max(50, 'pageSize 不能大于 50')
    .optional()
    .default(10),
  phase: z.coerce
    .number()
    .refine((v) => v === 3 || v === 4, { message: 'phase 必须为 3 或 4' })
    .optional(),
  unitId: z.coerce.number().int().min(1, 'unitId 必须为正整数').optional(),
  keyword: z.string().max(100, 'keyword 过长').optional(),
  scoreBand: z
    .enum(['all', 'high', 'mid', 'low'], { message: 'scoreBand 必须为 all/high/mid/low' })
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

// ============== 管理员日志管理（统一三子页）==============

/** api_call_log 列表查询校验 */
export const adminApiCallLogListSchema = z.object({
  page: z.coerce.number().int().min(1, 'page 不能小于 1').optional().default(1),
  pageSize: z.coerce
    .number()
    .int()
    .min(1, 'pageSize 不能小于 1')
    .max(100, 'pageSize 不能大于 100')
    .optional()
    .default(20),
  method: z
    .enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH'], {
      message: 'method 必须为 GET/POST/PUT/DELETE/PATCH',
    })
    .optional(),
  statusCodeGroup: z
    .enum(['success', '4xx', '5xx'], { message: 'statusCodeGroup 必须为 success/4xx/5xx' })
    .optional(),
  pathKeyword: z.string().max(100, '路径关键词不能超过 100 字').optional(),
  userId: z.coerce.number().int().min(1, 'userId 不能小于 1').optional(),
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式必须为 YYYY-MM-DD')
    .optional(),
  endDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式必须为 YYYY-MM-DD')
    .optional(),
})

/** cloud_service_call_log 列表查询校验 */
export const adminCloudServiceLogListSchema = z.object({
  page: z.coerce.number().int().min(1, 'page 不能小于 1').optional().default(1),
  pageSize: z.coerce
    .number()
    .int()
    .min(1, 'pageSize 不能小于 1')
    .max(100, 'pageSize 不能大于 100')
    .optional()
    .default(20),
  service: z
    .enum(['deepseek', 'tts', 'oss', 'nls', 'bss', 'aiContent'], {
      message: 'service 必须为 deepseek/tts/oss/nls/bss/aiContent',
    })
    .optional(),
  success: z.coerce
    .number()
    .refine((v) => v === 0 || v === 1, 'success 必须为 0 或 1')
    .optional(),
  operationKeyword: z.string().max(50, '操作关键词不能超过 50 字').optional(),
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式必须为 YYYY-MM-DD')
    .optional(),
  endDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式必须为 YYYY-MM-DD')
    .optional(),
})

/** admin_operation_log 列表查询校验（V2，含日期范围，给 /api/admin/logs/operation 用） */
export const adminOperationLogListSchemaV2 = z.object({
  page: z.coerce.number().int().min(1, 'page 不能小于 1').optional().default(1),
  pageSize: z.coerce
    .number()
    .int()
    .min(1, 'pageSize 不能小于 1')
    .max(100, 'pageSize 不能大于 100')
    .optional()
    .default(20),
  action: z.string().max(50, '操作类型不能超过 50 字').optional(),
  keyword: z.string().max(50, '搜索关键词不能超过 50 字').optional(),
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式必须为 YYYY-MM-DD')
    .optional(),
  endDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式必须为 YYYY-MM-DD')
    .optional(),
})

/** review_access_log 列表查询校验（审核留痕子页，枚举复用 shared 常量防漂移） */
export const reviewAccessLogListSchema = z.object({
  page: z.coerce.number().int().min(1, 'page 不能小于 1').optional().default(1),
  pageSize: z.coerce
    .number()
    .int()
    .min(1, 'pageSize 不能小于 1')
    .max(100, 'pageSize 不能大于 100')
    .optional()
    .default(20),
  targetType: z
    .enum(REVIEW_TARGET_TYPES, {
      message: `targetType 必须为 ${REVIEW_TARGET_TYPES.join('/')}`,
    })
    .optional(),
  reasonCategory: z
    .enum(REVIEW_REASON_CATEGORIES, {
      message: 'reasonCategory 不在白名单内',
    })
    .optional(),
  keyword: z.string().max(100, '搜索关键词不能超过 100 字').optional(),
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式必须为 YYYY-MM-DD')
    .optional(),
  endDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式必须为 YYYY-MM-DD')
    .optional(),
})

// ============== 管理后台批量操作 ==============

/** 批量 ids 数组：去重正整数，默认上限 100 */
const batchIds = (max = 100) =>
  z
    .array(z.number().int().positive('id 必须为正整数'))
    .min(1, 'ids 不能为空')
    .max(max, `ids 数量不能超过 ${max}`)
    .transform((arr) => [...new Set(arr)])

/** 材料批量操作校验（delete=批量软删 / move=批量修改所属单元） */
export const adminSegmentBatchSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('delete'), ids: batchIds() }),
  z.object({
    action: z.literal('move'),
    ids: batchIds(),
    unitId: z.number().int().min(0, 'unitId 不能为负数'),
  }),
])

/** 单元批量操作校验（仅 delete） */
export const adminUnitBatchSchema = z.object({
  action: z.literal('delete'),
  ids: batchIds(),
})

/** 上传记录批量操作校验（delete / reprocess，reprocess 上限 20 与批量上传对齐防挤爆队列） */
export const adminMaterialRecordBatchSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('delete'), ids: batchIds() }),
  z.object({
    action: z.literal('reprocess'),
    ids: batchIds(20),
    unitId: z.number().int().min(0, 'unitId 不能为负数'),
  }),
])

/** 用户批量操作校验（ban=封禁 / unban=解封 / delete=销号） */
export const adminUserBatchSchema = z.object({
  action: z.enum(['ban', 'unban', 'delete'], { message: 'action 必须为 ban/unban/delete' }),
  ids: batchIds(),
})

// ============== 公告模块 ==============

/**
 * datetime 字符串校验：兼容 el-date-picker 的 'YYYY-MM-DD HH:mm:ss' 与 ISO 格式。
 * 项目既有 date 校验用正则（YYYY-MM-DD），但公告需精确到时分秒且前端控件格式多样，
 * 故改用「new Date 可解析」的宽松校验，避免前端格式与固定正则对不上导致恒 400。
 */
const datetimeString = z
  .string()
  .refine((v) => !Number.isNaN(new Date(v).getTime()), '时间格式不正确')

/** 两者都有时校验 publishAt < expireAt（跨字段 refine 复用） */
function publishBeforeExpire(d: { publishAt?: string | null; expireAt?: string | null }): boolean {
  if (d.publishAt && d.expireAt) return new Date(d.publishAt) < new Date(d.expireAt)
  return true
}

/** 用户端公告列表查询校验（query string，必须 z.coerce） */
export const noticeListSchema = z.object({
  page: z.coerce.number().int().min(1, 'page 不能小于 1').optional().default(1),
  pageSize: z.coerce
    .number()
    .int()
    .min(1, 'pageSize 不能小于 1')
    .max(50, 'pageSize 不能大于 50')
    .optional()
    .default(10),
})

/** 管理端公告列表查询校验（含状态筛选 + 标题关键词） */
export const adminNoticeListSchema = z.object({
  page: z.coerce.number().int().min(1, 'page 不能小于 1').optional().default(1),
  pageSize: z.coerce
    .number()
    .int()
    .min(1, 'pageSize 不能小于 1')
    .max(50, 'pageSize 不能大于 50')
    .optional()
    .default(10),
  status: z
    .enum(['all', 'draft', 'published', 'revoked'], {
      message: 'status 必须为 all/draft/published/revoked',
    })
    .optional()
    .default('all'),
  keyword: z.string().max(100, '搜索关键词不能超过 100 个字符').optional(),
})

/** 管理端公告创建校验（status 仅 draft/published；refine publishAt<expireAt） */
export const adminNoticeCreateSchema = z
  .object({
    title: z.string().min(1, '标题不能为空').max(200, '标题不能超过 200 个字符'),
    content: z.string().min(1, '正文不能为空').max(5000, '正文不能超过 5000 个字符'),
    publishAt: datetimeString.nullish(),
    expireAt: datetimeString.nullish(),
    isPinned: z.boolean().optional().default(false),
    status: z
      .enum(['draft', 'published'], { message: 'status 必须为 draft/published' })
      .optional()
      .default('draft'),
  })
  .refine(publishBeforeExpire, { message: '过期时间必须晚于发布时间', path: ['expireAt'] })

/** 管理端公告更新校验（全 optional，status 含 revoked；refine publishAt<expireAt） */
export const adminNoticeUpdateSchema = z
  .object({
    title: z.string().min(1, '标题不能为空').max(200, '标题不能超过 200 个字符').optional(),
    content: z.string().min(1, '正文不能为空').max(5000, '正文不能超过 5000 个字符').optional(),
    publishAt: datetimeString.nullish(),
    expireAt: datetimeString.nullish(),
    isPinned: z.boolean().optional(),
    status: z
      .enum(['draft', 'published', 'revoked'], {
        message: 'status 必须为 draft/published/revoked',
      })
      .optional(),
  })
  .refine(publishBeforeExpire, { message: '过期时间必须晚于发布时间', path: ['expireAt'] })

// ============== 通用工具 ==============

export function validateError(message: string, code: number = 400): ResPayload<never> {
  return { code, message, data: undefined as never }
}

export function validateSuccess<T>(data: T, message = '成功', code = 200) {
  return { code, message, data }
}
