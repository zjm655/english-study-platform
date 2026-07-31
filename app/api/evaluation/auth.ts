import { evaluationAuthPath } from '../paths'

export interface EvaluationAuthResult {
  warrantId: string
  applicationId: string
  expireAt: number
  /** 服务端签名用的 userId（游客为实体化后的 user.id，登录用户为自身 id），SDK initEngine 必须用此值 */
  userId: number
}

/**
 * 获取评测鉴权凭证。
 * @param phase 游客配额检查所需阶段标识（'dubbing' | 'shadow'），登录用户可省略
 */
export const getEvaluationAuth = async (phase?: 'dubbing' | 'shadow') => {
  return request<EvaluationAuthResult>(evaluationAuthPath, {
    method: 'POST',
    body: phase ? { phase } : undefined,
  })
}
