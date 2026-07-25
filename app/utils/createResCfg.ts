import type { FlatResCfg, CommonReqCfg } from '~/types/requestType'

/**
 * 扁平化工厂：把扁平配置转为标准请求配置
 * 用法：createResCfg({ handle: login, success: '登录成功' })
 */
export function createResCfg<Payload, Res>({
  success,
  clientFail,
  serverFail,
  error,
  notify,
  handle,
}: FlatResCfg<Payload, Res>): CommonReqCfg<Payload, Res> {
  return {
    tips: {
      success: success ?? '请求成功',
      clientFail: clientFail ?? '客户端错误',
      serverFail: serverFail ?? '服务器错误',
      error: error ?? '未知错误',
    },
    notify,
    handle,
  }
}
