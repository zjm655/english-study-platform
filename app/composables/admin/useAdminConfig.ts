import { getConfigs, updateConfig, type AdminConfigMap } from '~/api/admin/config'

/** 获取系统配置 */
export const useConfigs = () => {
  const cfg = createResCfg<null, AdminConfigMap>({
    handle: () => getConfigs(),
    success: '',
    clientFail: '获取配置失败',
    serverFail: '服务器异常，获取配置失败',
    error: '网络异常，请检查网络',
  })
  return useHandleRes(cfg)
}

/** 更新单个配置项 */
export const useUpdateConfig = () => {
  const cfg = createResCfg<{ key: string; value: string }, null>({
    handle: (payload) => updateConfig(payload),
    success: '保存成功',
    clientFail: '保存失败',
    serverFail: '服务器异常，保存失败',
    error: '网络异常，保存失败',
  })
  return useHandleRes(cfg)
}

/**
 * 批量更新配置：内部 Promise.all 并发提交多个配置项。
 * 用单次 execute 聚合，规避 useHandleRes 防重锁对「同一实例并发 execute」的限制。
 */
export const useUpdateConfigs = () => {
  const cfg = createResCfg<Array<{ key: string; value: string }>, null>({
    handle: async (entries) => {
      const results = await Promise.all(entries.map((e) => updateConfig(e)))
      const failed = results.find((r) => r.code !== 200)
      return failed ?? { code: 200, message: '保存成功', data: null }
    },
    success: '保存成功',
    clientFail: '保存失败',
    serverFail: '服务器异常，保存失败',
    error: '网络异常，保存失败',
  })
  return useHandleRes(cfg)
}
