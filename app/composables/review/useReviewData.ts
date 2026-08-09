import { getReviewVocab, getReviewMaterial } from '~/api/review'
import type { ReviewVocabResult, ReviewMaterialResult } from '~/api/review'

export interface ReviewVocabQuery {
  limit: number
  offset: number
  keyword?: string
}

export interface ReviewMaterialQuery {
  limit: number
  offset: number
  keyword?: string
}

export const useReviewData = () => {
  const vocabCfg = createResCfg<ReviewVocabQuery, ReviewVocabResult>({
    handle: ({ limit, offset, keyword }) => getReviewVocab(limit, offset, keyword),
    success: '',
    clientFail: '',
    serverFail: '',
    error: '',
  })
  const { isLoading: isVocabLoading, execute: executeVocab } = useHandleRes(vocabCfg)

  const materialCfg = createResCfg<ReviewMaterialQuery, ReviewMaterialResult>({
    handle: ({ limit, offset, keyword }) => getReviewMaterial(limit, offset, keyword),
    success: '',
    clientFail: '',
    serverFail: '',
    error: '',
  })
  const { isLoading: isMaterialLoading, execute: executeMaterial } = useHandleRes(materialCfg)

  return { executeVocab, isVocabLoading, executeMaterial, isMaterialLoading }
}
