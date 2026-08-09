import { adminSegmentUploadPath } from '~/api/paths'
import type { AdminUploadResponse } from '#shared/types/adminUpload'

/**
 * 管理员材料上传（单条 / 批量）。
 * 批量上传耗时较长（多文件串行 TTS + AI），超时放宽到 10 分钟。
 */
export const adminUploadMaterial = async (payload: FormData) => {
  return request.file<AdminUploadResponse>(adminSegmentUploadPath, {
    method: 'POST',
    body: payload,
    signal: AbortSignal.timeout(600_000),
  })
}
