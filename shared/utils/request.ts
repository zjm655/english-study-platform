// shared/utils/request.ts
import { $fetch } from 'ofetch'
import type { FetchContext } from 'ofetch'
import type { ResPayload } from '#shared/types/request.d.ts'
// import { useRequestHeaders } from '#app'

interface BaseCfg {
  baseURL?: string
  credentials?: RequestCredentials
}

export const createFetch = ({ baseURL='', credentials = 'include'}: BaseCfg = {}) =>
  $fetch.create({
    baseURL,
    credentials: import.meta.client ? credentials : undefined,

    onRequest(ctx: FetchContext) {
      const { request, options } = ctx
      // if (import.meta.server) {
      //   const headers = useRequestHeaders(['cookie'])
      //   if (headers.cookie) {
      //     options.headers = new Headers(options.headers)
      //     options.headers.set('cookie', headers.cookie)
      //   }
      // }
      logger.info(
        `请求拦截器 - 发送请求: ${request}  请求类型：${options.method ?? 'GET'}`,
      )
    },

    onResponse(ctx: FetchContext) {
      const response = ctx.response
      if (!response) return
      logger.info(
        `响应拦截器 - 收到响应: ${(response._data as ResPayload<unknown>)?.message || '无提示'}, 来源：${response.url}`,
      )
      if(import.meta.client){
        logger.info("完整响应：", response)
      }
    },

    onResponseError(ctx: FetchContext) {
        const response = ctx.response
        if (!response) return
        const body = response._data as Record<string, unknown> | undefined
        logger.warn(
            `响应拦截器 - 错误响应: ${response.status}, ${(body)?.message}`,
        )
        throw {
            code: response.status,
            message: (body?.message as string) || '请求失败',
            data: null,
        } satisfies ResPayload<null>
    },
  })