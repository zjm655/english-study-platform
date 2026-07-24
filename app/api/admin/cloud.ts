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

// 云服务用量/费用接口均需调用外部阿里云 / DeepSeek API（含官方统计与账单），
// 网络往返 + 上游聚合远超默认 5s 超时，故统一用 request.slow。

/** OSS 对象存储用量（本地估算 + 官方 GetBucketStat） */
export const getAdminCloudOss = (options: CloudEstimateQuery = {}) => {
  return request.slow<OssStatResult>(`${adminCloudOssPath}${buildQuery({ days: options.days })}`)
}

/** NLS 智能语音交互用量（本地估算） */
export const getAdminCloudNls = (options: CloudEstimateQuery = {}) => {
  return request.slow<NlsStatResult>(`${adminCloudNlsPath}${buildQuery({ days: options.days })}`)
}

/** 智能科教平台用量（本地估算） */
export const getAdminCloudEdu = (options: CloudEstimateQuery = {}) => {
  return request.slow<EduStatResult>(`${adminCloudEduPath}${buildQuery({ days: options.days })}`)
}

/** BSS 费用中心（余额 + 账单） */
export const getAdminCloudBss = (options: { billingCycle?: string } = {}) => {
  return request.slow<BssStatResult>(
    `${adminCloudBssPath}${buildQuery({ billingCycle: options.billingCycle })}`,
  )
}

/** DeepSeek 账户余额 */
export const getAdminCloudDeepseek = () => {
  return request.slow<DeepSeekStatResult>(adminCloudDeepseekPath)
}

/** 云服务调用趋势（按天聚合） */
export const getAdminCloudTrend = (options: CloudTrendQuery) => {
  return request.slow<CloudTrendResult>(
    `${adminCloudTrendPath}${buildQuery({ service: options.service, days: options.days })}`,
  )
}
