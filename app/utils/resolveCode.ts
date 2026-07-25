import type { LogCfg } from '~/types/requestType'
import { useUserStore } from '~/store/useUserStore'
import { toastSuccess, toastError, toastWarning, toastInfo } from '~/utils/popup'

// toast 仅限客户端：import.meta.client 由 Nuxt 编译期替换；vitest 无 Nuxt 编译管线
// （值为 undefined），回退用 window 判定（happy-dom 有 window，SSR 无）
const isClient = import.meta.client ?? typeof window !== 'undefined'

// 401/403 引导提示节流：并发请求同时鉴权失败时（如中间件 verify + 页面首批请求），
// 只弹一次提示，避免连弹刷屏。模块级状态仅在 client 使用（toast 均有 client 守卫）。
const AUTH_TOAST_THROTTLE_MS = 3000
let lastAuthToastAt = 0

function canToastAuth() {
  const now = Date.now()
  if (now - lastAuthToastAt < AUTH_TOAST_THROTTLE_MS) return false
  lastAuthToastAt = now
  return true
}

/**
 * 状态码处理工具：根据后端返回的 code 进行日志记录、toast 提示、鉴权失效处理
 * 注意：401/403 会异步清除 Cookie 并跳转，调用方不应依赖其返回值
 *
 * toast 规则（写弹读静默）：
 * - logCfg.notify === 'all'：成功+失败都弹；'fail'：仅失败弹；缺省：不弹（只写控制台日志）
 * - silent = true 时常规 toast 与日志一并抑制（分页等场景），但 401/403 的
 *   Cookie 清理、跳转与登录引导提示**不受 notify/silent 影响**，始终执行
 * - 428 为业务流转码（如登录需图形验证码），由页面 UI 承接，不弹提示
 * @param silent 静默模式：跳过常规日志与 toast，但 401/403 的处理仍会执行
 */
export async function resolveCode(logCfg: LogCfg, silent = false) {
  const notify = !silent && isClient ? logCfg.notify : undefined
  switch (logCfg.code) {
    case 200: {
      if (!silent) logger.log(logCfg.tips.success || logCfg.message || '请求成功')
      const successText = logCfg.tips.success || logCfg.message
      // 空文案不弹（兼容 success: '' 的静默成功配置）
      if (notify === 'all' && successText) toastSuccess(successText)
      return true
    }
    case 400:
      if (!silent) logger.warn(logCfg.tips.clientFail || logCfg.message || '客户端请求异常')
      if (notify) toastError(logCfg.tips.clientFail || logCfg.message || '客户端请求异常')
      break
    case 500:
      if (!silent) logger.error(logCfg.tips.serverFail || logCfg.message || '服务器内部错误')
      if (notify) toastError(logCfg.tips.serverFail || logCfg.message || '服务器内部错误')
      break
    case 401: {
      if (!silent) logger.warn(logCfg.message || '登录已过期，请重新登录')
      const tokenCookie = useCookie('token')
      // 清 cookie 前判断：有 token 是登录过期，无 token 是游客触碰登录态功能
      if (isClient && canToastAuth()) {
        toastWarning(tokenCookie.value ? '登录已过期，请重新登录' : '请先登录')
      }
      tokenCookie.value = null
      const userStore = useUserStore()
      userStore.clearUser()
      await navigateTo('/login')
      break
    }
    case 403: {
      if (!silent) logger.warn(logCfg.message || '权限不足')
      if (isClient && canToastAuth()) {
        toastWarning(logCfg.message || '权限不足')
      }
      const tokenCookie = useCookie('token')
      tokenCookie.value = null
      const userStore = useUserStore()
      userStore.clearUser()
      await navigateTo('/')
      break
    }
    case 404:
      if (!silent) logger.info(logCfg.message || '资源不存在')
      if (notify) toastInfo(logCfg.message || '资源不存在')
      break
    case 428:
      // 业务流转码（登录需图形验证码等），由页面 UI 承接，不弹提示
      if (!silent) logger.info(logCfg.message || '需要进一步验证')
      break
    case -1:
      if (!silent) logger.error(logCfg.tips.error || logCfg.message || '网络异常')
      if (notify) toastError(logCfg.tips.error || logCfg.message || '网络异常')
      break
    default:
      if (!silent) logger.error(logCfg.tips.error || logCfg.message || '未知错误')
      if (notify) toastError(logCfg.tips.error || logCfg.message || '未知错误')
      break
  }
  return false
}
