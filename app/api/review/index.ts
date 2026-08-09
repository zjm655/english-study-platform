import { reviewVocabPath, reviewMaterialPath } from '~/api/paths'
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
  return request<ReviewVocabResult>(`${reviewVocabPath}${buildQuery({ limit, offset, keyword })}`, {
    method: 'GET',
  })
}

export const getReviewMaterial = async (limit = 5, offset = 0, keyword?: string) => {
  return request<ReviewMaterialResult>(
    `${reviewMaterialPath}${buildQuery({ limit, offset, keyword })}`,
    { method: 'GET' },
  )
}
