import {
  queryAccountBalance,
  queryBill,
  queryBillOverview,
  queryCashCoupons,
  queryPrepaidCards,
  queryMonthlySpendTrend,
} from '#server/services/bss'
import { validateSuccess, validateError } from '#server/utils/validate'
import { ensurePermission } from '#server/services/permission'
import { PERMISSIONS } from '#shared/utils/permission'
import { z } from 'zod'

/** BSS 查询参数校验（billingCycle 可选，默认当月） */
const bssQuerySchema = z.object({
  billingCycle: z
    .string()
    .regex(/^\d{4}-\d{2}$/, '账期格式应为 YYYY-MM')
    .optional(),
})

/**
 * BSS 费用中心（账户余额 + 账单明细 + 账单总览 + 代金券 + 预付卡 + 月度趋势）
 * GET /api/admin/cloud/bss?billingCycle=2026-07
 *
 * 各数据源独立降级，互不阻断；外部调用并行发起。
 */
export default defineEventHandler(async (event) => {
  const err = ensurePermission(event, PERMISSIONS.VIEW_STATS)
  if (err) return err

  const parsed = bssQuerySchema.safeParse(getQuery(event))
  if (!parsed.success) {
    return validateError(parsed.error?.issues?.[0]?.message ?? '参数校验失败', 400)
  }

  // 默认当月
  const now = new Date()
  const billingCycle =
    parsed.data.billingCycle ??
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

  const [balance, bill, billOverview, coupons, prepaidCards, monthlyTrend] = await Promise.all([
    queryAccountBalance(),
    queryBill(billingCycle),
    queryBillOverview(billingCycle),
    queryCashCoupons(),
    queryPrepaidCards(),
    queryMonthlySpendTrend(6),
  ])

  return validateSuccess(
    { balance, bill, billOverview, coupons, prepaidCards, monthlyTrend },
    '获取 BSS 费用数据成功',
  )
})
