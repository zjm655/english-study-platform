// app/composables/user/useVerifySSR.ts
import { appendResponseHeader } from 'h3'
import { userVerifyPath } from '~/api/paths'
import { useUserStore } from '~/store/useUserStore'
import type { LoginResPayload } from '#shared/types/user'
import type { ResPayload } from '#shared/types/request'

/**
 * SSR 期登录校验（仅由 app/plugins/authVerify.server.ts 调用）
 *
 * 与 useToVerify（client 命令式链路）平行并存，不复用其 raw ofetch 通道：
 * raw ofetch 在 SSR 端无法解析相对路径，resolveCode 的 401→navigateTo
 * 也是纯客户端语义。这里用 useRequestFetch 内部直调 Nitro handler
 * （自动透传原始请求 cookie，无 HTTP 回环）。
 *
 * 成功：user/isLogin/isVerify 写入 Pinia → payload 序列化 → client 水合复用，
 * 客户端不再重复发 verify。
 * 失败/超时/游客：不落任何状态、不清 cookie、不重定向——留给 client
 * 中间件兜底（行为与现状等价，也天然规避 /login SSR 重定向循环）。
 */
export async function useVerifySSR(): Promise<void> {
  // 无 cookie（游客/爬虫）短路：零内部调用、零 DB
  const token = useCookie('token').value
  if (!token) return

  const userStore = useUserStore()
  const event = useRequestEvent()
  const requestFetch = useRequestFetch()

  try {
    // 注意：不能用 requestFetch.raw()——SSR 端 useRequestFetch 返回的是 Nitro
    // event.$fetch（fetchWithEvent 的函数包装），类型标注虽是 $Fetch 但运行时
    // 没有 .raw/.create 方法，调用会直接 TypeError；改用 onResponse 拦截器拿响应头
    const payload = await requestFetch<ResPayload<LoginResPayload>>(userVerifyPath, {
      signal: AbortSignal.timeout(5000),
      onResponse({ response }) {
        // 续期透传（必做）：token 滑动续期只发生在 verify handler，其 setCookie
        // 落在内部子请求 event 上不会到达浏览器；不透传则续期链路彻底断裂
        if (!event) return
        const cookies = response.headers.getSetCookie?.() ?? []
        for (const cookie of cookies) {
          appendResponseHeader(event, 'set-cookie', cookie)
        }
      },
    })

    // 业务 401/403 是 HTTP 200 + body.code（validateError 不设 HTTP 状态）
    if (payload?.code === 200 && payload.data) {
      userStore.setUser(payload.data)
      userStore.isLogin = true
      userStore.isVerify = true
    }
  } catch (err) {
    // 网络异常/超时：静默降级为未校验态，client 兜底重新 verify
    logger.warn(
      '[VerifySSR] SSR 登录校验失败，降级为客户端校验：',
      err instanceof Error ? err.message : err,
    )
  }
}
