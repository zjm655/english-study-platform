import { reviewVocabPath, reviewMaterialPath } from '../paths'
import { request } from '~/utils/request'
import type { ReviewVocabItem, ReviewMaterialItem } from '#shared/types/review'

export interface ReviewVocabResult {
  items: ReviewVocabItem[]
  total: number
}

export interface ReviewMaterialResult {
  items: ReviewMaterialItem[]
  total: number
}

export const getReviewVocab = async (limit = 10, offset = 0, keyword?: string) => {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) })
  if (keyword) params.set('keyword', keyword)
  return request<ReviewVocabResult>(`${reviewVocabPath}?${params}`, { method: 'GET' })
}

export const getReviewMaterial = async (limit = 5, offset = 0, keyword?: string) => {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) })
  if (keyword) params.set('keyword', keyword)
  return request<ReviewMaterialResult>(`${reviewMaterialPath}?${params}`, { method: 'GET' })
}
