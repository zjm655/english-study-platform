import { adminConfigPath } from '~/api/paths'

/** 系统配置映射：config_key → { value, description } */
export type AdminConfigMap = Record<string, { value: string; description: string | null }>

/** 获取全部系统配置 */
export const getConfigs = () => request<AdminConfigMap>(adminConfigPath)

/** 更新单个配置项 */
export const updateConfig = (payload: { key: string; value: string }) =>
  request<null>(adminConfigPath, { method: 'PUT', body: payload })
