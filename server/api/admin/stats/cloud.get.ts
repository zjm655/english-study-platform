import { queryAccountBalance } from '#server/utils/bss'
import { validateSuccess, validateError } from '#server/utils/validate'
import { ROLE_ADMIN } from '#shared/utils/role'

/**
 * 云服务用量（阿里云 BSS 账户余额）
 * GET /api/admin/stats/cloud
 *
 * 【探索性质】BSS 文档不全，本端点独立于主统计接口，失败时返回 success=false 的
 * 业务数据（HTTP 仍 200），前端据此展示"暂不可用"而非报错。
 */
export default defineEventHandler(async (event) => {
  // 纵深防御：中间件已对 /api/admin/* 做管理员门禁，此处再校验一次
  const user = event.context.user
  if (!user || user.role !== ROLE_ADMIN) {
    return validateError('无管理员权限', 403)
  }

  const balance = await queryAccountBalance()
  return validateSuccess(balance, balance.success ? '获取云账户余额成功' : '云账户余额暂不可用')
})
