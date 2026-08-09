import { materialUploadPath } from '~/api/paths'
import type { UploadMaterialResult } from '#shared/types/material'

export const uploadMaterial = async (payload: FormData) => {
  return request.file<UploadMaterialResult>(materialUploadPath, {
    method: 'POST',
    body: payload,
    // 异步任务模式：后端秒回 recordId，30s 仅为大音频上行传输留余量
    signal: AbortSignal.timeout(30_000),
  })
}
