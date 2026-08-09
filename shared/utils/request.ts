// shared/utils/request.ts
import { $fetch } from 'ofetch'
import type { FetchContext } from 'ofetch'
import type { ResPayload } from '#shared/types/request'

interface BaseCfg {
  baseURL?: string
  credentials?: RequestCredentials
}

export const createFetch = ({ baseURL = '', credentials = 'include' }: BaseCfg = {}) =>
  $fetch.create({
    baseURL,
    credentials: import.meta.client ? credentials : undefined,

    onRequest(ctx: FetchContext) {
      const { request, options } = ctx
      // SSR cookie 透传不在此处做（拦截器内无 Nuxt 上下文，raw ofetch 在 SSR 端也无法解析相对路径），
      // 需要 SSR 直出的数据请走 app/composables/useAsyncRes.ts（useRequestFetch）；本工具保持 client 语义
      logger.info(`请求拦截器 - 发送请求: ${request}  请求类型：${options.method ?? 'GET'}`)
    },

    onResponse(ctx: FetchContext) {
      const response = ctx.response
      if (!response) return
      logger.info(
        `响应拦截器 - 收到响应: ${(response._data as ResPayload<unknown>)?.message || '无提示'}, 来源：${response.url}`,
      )
      if (import.meta.client) {
        logger.info('完整响应：', response)
      }
    },

    onResponseError(ctx: FetchContext) {
      const response = ctx.response
      if (!response) return
      const body = response._data as Record<string, unknown> | undefined
      logger.warn(`响应拦截器 - 错误响应: ${response.status}, ${body?.message}`)
      throw {
        code: response.status,
        message: (body?.message as string) || '请求失败',
        data: null,
      } satisfies ResPayload<null>
    },
  })
