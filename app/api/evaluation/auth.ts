import { evaluationAuthPath } from '../paths'

export interface EvaluationAuthResult {
  warrantId: string
  applicationId: string
  expireAt: number
}

export const getEvaluationAuth = async () => {
  return request<EvaluationAuthResult>(evaluationAuthPath, {
    method: 'POST',
  })
}
