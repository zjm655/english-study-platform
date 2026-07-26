/** 管理员材料管理共享类型（列表 / 详情 / 编辑） */
import type { Question } from './unit'

/** 材料列表项（精简字段，不含大文本，降低列表 payload） */
export interface AdminSegmentListItem {
  id: number
  title: string
  unitId: number
  unitTitle: string
  isPublic: number // 0 私有 1 公开
  sortOrder: number
  createdAt: string
}

/** 材料列表查询参数（query string，后端 zod coerce） */
export interface AdminSegmentListQuery {
  page?: number
  pageSize?: number
  unitId?: number // 0 = 用户自定义材料单元
  isPublic?: number // 0 | 1
  keyword?: string // 按标题模糊搜索
}

/** 材料列表响应（服务端分页） */
export interface AdminSegmentListResult {
  list: AdminSegmentListItem[]
  total: number
  page: number
  pageSize: number
}

/** 词汇编辑项（有 id = 更新现有；无 id = 新增） */
export interface AdminVocabEditItem {
  id?: number
  word: string
  forms?: string | null
  phonetic?: string | null
  meaning: string
  exampleSentence?: string | null
  exampleTranslation?: string | null
}

/** 材料详情（编辑页加载用） */
export interface AdminSegmentDetail {
  id: number
  title: string
  textContent: string
  translation: string | null
  questions: Question[]
  isPublic: number
  unitId: number
  unitTitle: string
  vocabulary: AdminVocabEditItem[]
  /** 音频签名 URL（契约纯增量）：可播放时为签名 URL，非公开用户材料被门禁扣留时为 null */
  audioUrl?: string | null
  /** 音频时长（秒） */
  duration?: number | null
  /** 音频被门禁锁定：有音频但因「非公开用户材料」被扣留，供前端决定是否显示「填理由解锁」 */
  audioLocked?: boolean
  /** 公开状态被门禁锁定：非公开的用户材料，其公开状态变更需走 REVIEW 门禁 + 留痕 */
  visibilityLocked?: boolean
}

/** 材料编辑载荷（仅文本字段，不触发 TTS/AI 再生成） */
export interface AdminSegmentUpdatePayload {
  title: string
  textContent: string
  translation?: string | null
  questions?: Question[]
  vocabulary?: AdminVocabEditItem[]
  isPublic?: number // 0 | 1
  /** 所属单元变更（可选；0=自定义单元合法） */
  unitId?: number
}

/** 材料公开状态门禁变更载荷（需 REVIEW 权限 + 填理由，镜像音频试听留痕） */
export interface AdminSegmentVisibilityPayload {
  isPublic: number // 0 | 1
  reasonCategory: string
  reason: string
}
