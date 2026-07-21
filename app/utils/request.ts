// app/utils/request.ts
import { createFetch } from '#shared/utils/request'
import type { ResPayload } from '#shared/types/request'

const _request = createFetch()

const DEFAULT_TIMEOUT = 5000
const FILE_TIMEOUT = 30000

/** 通用请求（向后兼容，现有 JSON 调用无需改动） */
export const request = Object.assign(
  function <T>(path: string, options?: Record<string, unknown>) {
    return _request<ResPayload<T>>(path, {
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT),
      ...options,
    })
  },
  {
    /** JSON 请求：显式设置 Content-Type: application/json */
    json<T>(path: string, options?: Record<string, unknown>) {
      return _request<ResPayload<T>>(path, {
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT),
        headers: { 'Content-Type': 'application/json' },
        ...options,
      })
    },

    /** 文件请求：30s 超时，不设 Content-Type（浏览器自动设置 multipart/form-data boundary） */
    file<T>(path: string, options?: Record<string, unknown>) {
      return _request<ResPayload<T>>(path, {
        signal: AbortSignal.timeout(FILE_TIMEOUT),
        ...options,
      })
    },
  },
)
