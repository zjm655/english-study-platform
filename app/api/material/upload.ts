import { materialUploadPath } from '../paths'
import type { UploadMaterialResult } from '#shared/types/material'

export const uploadMaterial = async (payload: FormData) => {
  return request.file<UploadMaterialResult>(materialUploadPath, {
    method: 'POST',
    body: payload,
    signal: AbortSignal.timeout(120_000),
  })
}