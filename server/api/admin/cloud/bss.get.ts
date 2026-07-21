import { queryAccountBalance, queryBill } from '#server/utils/bss'
import { validateSuccess, validateError } from '#server/utils/validate'
import { ROLE_ADMIN } from '#shared/utils/role'
import { z } from 'zod'

/** BSS 查询参数校验（billingCycle 可选，默认当月） */
const bssQuerySchema = z.object({
  billingCycle: z.string().regex(/^\d{4}-\d{2}$/, '账期格式应为 YYYY-MM').optional(),
})

/**
 * BSS 费用中心（账户余额 + 账单明细）
 * GET /api/admin/cloud/bss?billingCycle=2026-07
 *
 * balance/bill 独立降级，互不阻断。
 */
export default defineEventHandler(async (event) => {
  const user = event.context.user
  if (!user || user.role !== ROLE_ADMIN) {
    return validateError('无管理员权限', 403)
  }

  const parsed = bssQuerySchema.safeParse(getQuery(event))
  if (!parsed.success) {
    return validateError(parsed.error?.issues?.[0]?.message ?? '参数校验失败', 400)
  }

  // 默认当月
  const now = new Date()
  const billingCycle = parsed.data.billingCycle
    ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

  const [balance, bill] = await Promise.all([
    queryAccountBalance(),
    queryBill(billingCycle),
  ])

  return validateSuccess({ balance, bill }, '获取 BSS 费用数据成功')
})
