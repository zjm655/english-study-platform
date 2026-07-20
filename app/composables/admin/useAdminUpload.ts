import { adminUploadMaterial } from '~/api/admin/upload'
import type { AdminUploadResponse } from '#shared/types/adminUpload'

/**
 * 管理员材料上传 composable（遵循三层约定：createResCfg + useHandleRes）。
 */
export const useAdminUpload = () => {
  const cfg = createResCfg<FormData, AdminUploadResponse>({
    handle: adminUploadMaterial,
    success: '上传完成',
    clientFail: '上传失败，请检查材料内容',
    serverFail: '服务器异常，上传失败',
    error: '网络异常，请检查网络',
  })
  return useHandleRes(cfg)
}
