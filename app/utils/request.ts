// app/utils/request.ts
import { createFetch } from '#shared/utils/request'
import type { ResPayload } from '#shared/types/request'

const _request = createFetch()

const DEFAULT_TIMEOUT = 5000

export function request<T>(path: string, options?: Record<string, unknown>) {
  return _request<ResPayload<T>>(path, {
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT),
    ...options,
  })
}