// app/composables/useAsyncRes.ts
import type { AsyncDataOptions } from '#app'
import type { ResPayload } from '#shared/types/request'

const DEFAULT_TIMEOUT = 5000

/**
 * SSR 友好的数据获取（与 useHandleRes 平行并存，不替代它）
 *
 * 适用场景：需要 SSR 直出 HTML / 依赖 cookie 鉴权的只读 GET 数据
 * （SEO 页面首屏数据）。写操作与命令式流程（toast/防重/loading 弹层）
 * 继续走 createResCfg + useHandleRes 三层链路。
 *
 * 实现要点：
 * - useRequestFetch()：SSR 期自动转发原始请求的 cookie 等 headers，且直接
 *   内部调用 Nitro handler（无 HTTP 回环）；client 期等价于普通 $fetch。
 *   这是 shared/utils/request.ts（raw ofetch）做不到的——raw ofetch 在
 *   SSR 端无法解析相对路径，useRequestHeaders 也不能在其拦截器内调用。
 * - 错误进入返回的 error ref（不弹 toast），由页面自行降级展示。
 *
 * 使用示例：
 *   const { data, pending, error, refresh } = useAsyncRes<UnitWithProgress[]>('units', unitsPath)
 *   const units = computed(() => data.value?.data ?? [])
 */
export function useAsyncRes<T>(
  key: string,
  path: string | (() => string),
  fetchOpts?: Record<string, unknown>,
  asyncOpts?: AsyncDataOptions<ResPayload<T>>,
) {
  // setup 期捕获（SSR 上下文内），fetcher 执行时复用
  const requestFetch = useRequestFetch()

  return useAsyncData<ResPayload<T>>(
    key,
    () =>
      requestFetch<ResPayload<T>>(toValue(path), {
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT),
        ...fetchOpts,
      }),
    {
      dedupe: 'defer',
      ...asyncOpts,
    },
  )
}
