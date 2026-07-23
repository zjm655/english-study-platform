import {
  adminCloudOssPath,
  adminCloudNlsPath,
  adminCloudEduPath,
  adminCloudBssPath,
  adminCloudDeepseekPath,
  adminCloudTrendPath,
} from '../paths'
import type {
  CloudEstimateQuery,
  OssStatResult,
  NlsStatResult,
  EduStatResult,
  BssStatResult,
  DeepSeekStatResult,
  CloudTrendQuery,
  CloudTrendResult,
} from '#shared/types/adminCloud'

/** OSS 对象存储用量（本地估算 + 官方 GetBucketStat） */
export const getAdminCloudOss = (options: CloudEstimateQuery = {}) => {
  const params = new URLSearchParams()
  if (options.days !== undefined && options.days !== null)
    params.append('days', String(options.days))
  const query = params.toString()
  return request.json<OssStatResult>(`${adminCloudOssPath}${query ? '?' + query : ''}`)
}

/** NLS 智能语音交互用量（本地估算） */
export const getAdminCloudNls = (options: CloudEstimateQuery = {}) => {
  const params = new URLSearchParams()
  if (options.days !== undefined && options.days !== null)
    params.append('days', String(options.days))
  const query = params.toString()
  return request.json<NlsStatResult>(`${adminCloudNlsPath}${query ? '?' + query : ''}`)
}

/** 智能科教平台用量（本地估算） */
export const getAdminCloudEdu = (options: CloudEstimateQuery = {}) => {
  const params = new URLSearchParams()
  if (options.days !== undefined && options.days !== null)
    params.append('days', String(options.days))
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

/** DeepSeek 账户余额 */
export const getAdminCloudDeepseek = () => {
  return request.json<DeepSeekStatResult>(adminCloudDeepseekPath)
}

/** 云服务调用趋势（按天聚合） */
export const getAdminCloudTrend = (options: CloudTrendQuery) => {
  const params = new URLSearchParams()
  params.append('service', options.service)
  if (options.days !== undefined && options.days !== null)
    params.append('days', String(options.days))
  const query = params.toString()
  return request.json<CloudTrendResult>(`${adminCloudTrendPath}?${query}`)
}
