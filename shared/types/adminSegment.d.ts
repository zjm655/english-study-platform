/** 管理员材料管理共享类型（列表 / 详情 / 编辑） */
import type { Question } from './unit'

/** 材料列表项（精简字段，不含大文本，降低列表 payload） */
export interface AdminSegmentListItem {
  id: number
  title: string
  unitId: number
  unitTitle: string
  isPublic: number        // 0 私有 1 公开
  sortOrder: number
  createdAt: string
}

/** 材料列表查询参数（query string，后端 zod coerce） */
export interface AdminSegmentListQuery {
  page?: number
  pageSize?: number
  unitId?: number         // 0 = 用户自定义材料单元
  isPublic?: number       // 0 | 1
  keyword?: string        // 按标题模糊搜索
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
}

/** 材料编辑载荷（仅文本字段，不触发 TTS/AI 再生成） */
export interface AdminSegmentUpdatePayload {
  title: string
  textContent: string
  translation?: string | null
  questions?: Question[]
  vocabulary?: AdminVocabEditItem[]
  isPublic?: number       // 0 | 1
}
