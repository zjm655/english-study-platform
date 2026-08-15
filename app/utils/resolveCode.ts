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
 * 注意：401 登录过期会异步清除 Cookie 并跳转；游客无 token 时仅 toast 提示不跳转
 *       403 会异步清除 Cookie 并跳转，调用方不应依赖其返回值
 *
 * toast 规则（写弹读静默）：
 * - logCfg.notify === 'all'：成功+失败都弹；'fail'：仅失败弹；缺省：不弹（只写控制台日志）
 * - silent = true 时常规 toast 与日志一并抑制（分页等场景），但 401/403 的
 *   鉴权处理（Cookie 清理、跳转或游客提示）**不受 notify/silent 影响**，始终执行
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
    case 400: // 服务端业务拒绝（validateError）message 是权威原因（如「队列已满」「材料为对话格式」），
    // 优先透出；缺失/为空时回退 tips.clientFail。风格同 401/403 的 message 优先。
    {
      const text = logCfg.message?.trim() || logCfg.tips.clientFail || '客户端请求异常'
      if (!silent) logger.warn(text)
      if (notify) toastError(text)
      break
    }
    case 500: {
      // 服务端 5xx message 优先（如「服务器异常，请稍后重试」），缺失时回退 tips.serverFail
      const text = logCfg.message?.trim() || logCfg.tips.serverFail || '服务器内部错误'
      if (!silent) logger.error(text)
      if (notify) toastError(text)
      break
    }
    case 401: {
      const tokenCookie = useCookie('token')
      const hasToken = !!tokenCookie.value
      // 优先透出服务端返回的 message（如「账号已注销」「账号或密码错误」）——登录/鉴权失败的真实原因
      // 在服务端，硬编码文案会吞掉它（曾致登录失败只弹笼统的「此功能需要登录」）；
      // message 缺失/为空时按 token 有无回退通用文案。风格同 403 分支（logCfg.message || '权限不足'）。
      const authText =
        logCfg.message?.trim() || (hasToken ? '登录已过期，请重新登录' : '此功能需要登录')
      if (!silent) logger.warn(authText)
      if (isClient && canToastAuth()) {
        // 区分游客与登录过期：游客仅温和提示，不跳转；登录过期走原有清 cookie + 跳转流程
        toastWarning(authText)
      }
      if (hasToken) {
        // 登录用户 token 失效：清 cookie、清用户状态、跳转登录页
        tokenCookie.value = null
        const userStore = useUserStore()
        userStore.clearUser()
        await navigateTo('/login')
      }
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
      // 网络异常/本地侧错误：无服务端权威文案，保持 tips.error 优先——
      // 避免 ofetch 网络失败抛出的英文（如 AbortError: The operation was aborted.）直弹给用户
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
