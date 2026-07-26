import { uploadMaterial } from '~/api/material/upload'
import type { UploadMaterialResult } from '#shared/types/material'

export const useUploadMaterial = () => {
  const cfg = createResCfg<FormData, UploadMaterialResult>({
    handle: uploadMaterial,
    success: '已加入处理队列',
    clientFail: '提交失败，请检查材料内容',
    serverFail: '服务器异常，提交失败',
    error: '网络异常，请检查网络',
    // 仅失败弹：成功提示由页面承接（含排队位置说明，信息量更大）
    notify: 'fail',
  })
  return useHandleRes(cfg)
}
