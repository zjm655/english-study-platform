import { getUploadLimits } from '#server/utils/uploadLimitChecker'
import { validateSuccess } from '#server/utils/validate'
import type { UploadLimits } from '#shared/types/uploadLimits'

/**
 * 获取上传限制配置（公开只读接口，游客可访问，见 publicRead.ts 白名单）
 * 请求：GET /api/config/upload-limits
 * 前端据此做上传前的本地预校验（时长/大小）；运营在管理端调整 sys_config 后 5min 内生效
 */
export default defineEventHandler(async (): Promise<ResPayload<UploadLimits>> => {
  const limits = await getUploadLimits()
  return validateSuccess(limits, '获取成功')
})
