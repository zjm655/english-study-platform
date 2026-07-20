import { reviewVocabPath, reviewMaterialPath } from '../paths'
import { request } from '~/utils/request'
import type { ReviewVocabItem, ReviewMaterialItem } from '#shared/types/review'

export const getReviewVocab = async (limit = 10) => {
  return request<ReviewVocabItem[]>(`${reviewVocabPath}?limit=${limit}`, { method: 'GET' })
}

export const getReviewMaterial = async (limit = 5) => {
  return request<ReviewMaterialItem[]>(`${reviewMaterialPath}?limit=${limit}`, { method: 'GET' })
}
