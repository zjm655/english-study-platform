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
    // 仅失败弹：成功提示由页面入队回执卡承接（含明细），与用户端 useUploadMaterial 同款约定；
    // 此前未设 notify 导致失败分支被 resolveCode 整体静默，管理员上传失败无任何可见反馈。
    notify: 'fail',
  })
  return useHandleRes(cfg)
}
