import { uploadMaterial } from '~/api/material/upload'
import type { UploadMaterialResult } from '#shared/types/material'

export const useUploadMaterial = () => {
  const cfg = createResCfg<FormData, UploadMaterialResult>({
    handle: uploadMaterial,
    success: '材料上传成功',
    clientFail: '上传失败，请检查材料内容',
    serverFail: '服务器异常，上传失败',
    error: '网络异常，请检查网络',
    // 仅失败弹：成功提示由页面承接（含「正在处理中」说明，信息量更大）
    notify: 'fail',
  })
  return useHandleRes(cfg)
}
