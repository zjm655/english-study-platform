import type { LogCfg } from '~/types/requestType'
import { useUserStore } from '~/store/useUserStore'

/**
 * 状态码处理工具：根据后端返回的 code 进行日志记录、鉴权失效处理
 * 注意：401/403 会异步清除 Cookie 并跳转，调用方不应依赖其返回值
 */
export async function resolveCode(logCfg: LogCfg) {
  switch (logCfg.code) {
    case 200:
      logger.log(logCfg.tips.success || logCfg.message || '请求成功')
      return true
    case 400:
      logger.warn(logCfg.tips.clientFail || logCfg.message || '客户端请求异常')
      break
    case 500:
      logger.error(logCfg.tips.serverFail || logCfg.message || '服务器内部错误')
      break
    case 401: {
      logger.warn(logCfg.message || '登录已过期，请重新登录')
      const tokenCookie = useCookie('token')
      tokenCookie.value = null
      const userStore = useUserStore()
      userStore.clearUser()
      await navigateTo('/login')
      break
    }
    case 403: {
      logger.warn(logCfg.message || '权限不足')
      const tokenCookie = useCookie('token')
      tokenCookie.value = null
      const userStore = useUserStore()
      userStore.clearUser()
      await navigateTo('/')
      break
    }
    case 404:
      logger.info(logCfg.message || '资源不存在')
      break
    case -1:
      logger.error(logCfg.tips.error || logCfg.message || '网络异常')
      break
    default:
      logger.error(logCfg.tips.error || logCfg.message || '未知错误')
      break
  }
  return false
}
