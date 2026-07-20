import { getAdminCloudOss, getAdminCloudNls, getAdminCloudEdu, getAdminCloudBss } from '~/api/admin/cloud'
import type { CloudEstimateQuery, OssStatResult, NlsStatResult, EduStatResult, BssStatResult } from '#shared/types/adminCloud'

/** OSS 对象存储用量（本地估算 + 官方 GetBucketStat） */
export const useAdminCloudOss = () => {
  const cfg = createResCfg<CloudEstimateQuery, OssStatResult>({
    handle: getAdminCloudOss,
    success: '获取 OSS 用量数据成功',
    clientFail: '获取 OSS 用量数据失败',
    serverFail: '服务器异常，获取 OSS 数据失败',
    error: '网络异常，请检查网络',
  })
  return useHandleRes(cfg)
}

/** NLS 智能语音交互用量（本地估算） */
export const useAdminCloudNls = () => {
  const cfg = createResCfg<CloudEstimateQuery, NlsStatResult>({
    handle: getAdminCloudNls,
    success: '获取 NLS 用量数据成功',
    clientFail: '获取 NLS 用量数据失败',
    serverFail: '服务器异常，获取 NLS 数据失败',
    error: '网络异常，请检查网络',
  })
  return useHandleRes(cfg)
}

/** 智能科教平台用量（本地估算） */
export const useAdminCloudEdu = () => {
  const cfg = createResCfg<CloudEstimateQuery, EduStatResult>({
    handle: getAdminCloudEdu,
    success: '获取智能科教用量数据成功',
    clientFail: '获取智能科教用量数据失败',
    serverFail: '服务器异常，获取智能科教数据失败',
    error: '网络异常，请检查网络',
  })
  return useHandleRes(cfg)
}

/** BSS 费用中心（余额 + 账单） */
export const useAdminCloudBss = () => {
  const cfg = createResCfg<{ billingCycle?: string }, BssStatResult>({
    handle: getAdminCloudBss,
    success: '获取 BSS 费用数据成功',
    clientFail: '获取 BSS 费用数据失败',
    serverFail: '服务器异常，获取 BSS 数据失败',
    error: '网络异常，请检查网络',
  })
  return useHandleRes(cfg)
}
