import { adminCloudOssPath, adminCloudNlsPath, adminCloudEduPath, adminCloudBssPath } from '../paths'
import type { CloudEstimateQuery, OssStatResult, NlsStatResult, EduStatResult, BssStatResult } from '#shared/types/adminCloud'

/** OSS 对象存储用量（本地估算 + 官方 GetBucketStat） */
export const getAdminCloudOss = (options: CloudEstimateQuery = {}) => {
  const params = new URLSearchParams()
  if (options.days !== undefined && options.days !== null) params.append('days', String(options.days))
  const query = params.toString()
  return request.json<OssStatResult>(`${adminCloudOssPath}${query ? '?' + query : ''}`)
}

/** NLS 智能语音交互用量（本地估算） */
export const getAdminCloudNls = (options: CloudEstimateQuery = {}) => {
  const params = new URLSearchParams()
  if (options.days !== undefined && options.days !== null) params.append('days', String(options.days))
  const query = params.toString()
  return request.json<NlsStatResult>(`${adminCloudNlsPath}${query ? '?' + query : ''}`)
}

/** 智能科教平台用量（本地估算） */
export const getAdminCloudEdu = (options: CloudEstimateQuery = {}) => {
  const params = new URLSearchParams()
  if (options.days !== undefined && options.days !== null) params.append('days', String(options.days))
  const query = params.toString()
  return request.json<EduStatResult>(`${adminCloudEduPath}${query ? '?' + query : ''}`)
}

/** BSS 费用中心（余额 + 账单） */
export const getAdminCloudBss = (options: { billingCycle?: string } = {}) => {
  const params = new URLSearchParams()
  if (options.billingCycle) params.append('billingCycle', options.billingCycle)
  const query = params.toString()
  return request.json<BssStatResult>(`${adminCloudBssPath}${query ? '?' + query : ''}`)
}
