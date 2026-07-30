// server/services/bss.ts
// 阿里云 BSS（费用中心）用量查询工具。
//
// 【探索性质】阿里云官方文档/示例不全，本封装以 QueryAccountBalance（账户余额）为切入点，
// 全部调用以 try/catch 包裹，失败时返回结构化错误而非抛异常，保证管理后台可优雅降级展示。
// 后续如需账单明细（QueryBill / DescribeInstanceBill）可按同模式扩展。

import RPCClient from '@alicloud/pop-core'
import { logCloudServiceCall } from '#server/utils/cloudServiceLog'

/** BSS 配置结构（runtimeConfig.bss） */
interface BssConfig {
  accessKeyId: string
  accessKeySecret: string
}

/** 账户余额查询结果 */
export interface AccountBalanceResult {
  success: boolean
  /** 可用额度（含信用额度） */
  availableAmount?: string
  /** 可用现金 */
  availableCashAmount?: string
  /** 信用额度 */
  creditAmount?: string
  /** 币种 */
  currency?: string
  /** 失败原因 */
  error?: string
}

/** BSS 费用中心 OpenAPI 端点与版本 */
const BSS_ENDPOINT = 'https://business.aliyuncs.com'
const BSS_API_VERSION = '2017-12-14'

/** 懒加载客户端（单例缓存）：配置缺失时返回 null（避免模块加载期读 runtimeConfig 失败） */
let cachedClient: RPCClient | null = null
function getClient(): RPCClient | null {
  if (cachedClient) return cachedClient
  const config = useRuntimeConfig().bss as BssConfig
  if (!config?.accessKeyId || !config?.accessKeySecret) return null
  cachedClient = new RPCClient({
    endpoint: BSS_ENDPOINT,
    apiVersion: BSS_API_VERSION,
    accessKeyId: config.accessKeyId,
    accessKeySecret: config.accessKeySecret,
  })
  return cachedClient
}

/**
 * 查询阿里云账户余额。
 * 失败（配置缺失 / 网络异常 / 权限不足 / API 变更）时返回 success=false + error，绝不抛异常。
 */
export async function queryAccountBalance(): Promise<AccountBalanceResult> {
  const client = getClient()
  if (!client) {
    return { success: false, error: 'BSS AccessKey 未配置' }
  }
  let callStart = 0
  try {
    callStart = Date.now()
    const res = (await client.request('QueryAccountBalance', {})) as {
      Data?: {
        AvailableAmount?: string
        AvailableCashAmount?: string
        CreditAmount?: string
        Currency?: string
      }
    }
    const data = res?.Data
    if (!data) {
      return { success: false, error: 'BSS 响应结构异常（无 Data 字段）' }
    }
    void logCloudServiceCall({
      service: 'bss',
      operation: 'queryAccountBalance',
      success: true,
      durationMs: Date.now() - callStart,
    })
    return {
      success: true,
      availableAmount: data.AvailableAmount,
      availableCashAmount: data.AvailableCashAmount,
      creditAmount: data.CreditAmount,
      currency: data.Currency,
    }
  } catch (err) {
    // pop-core 错误对象含 code / message（如 InvalidAccessKeyId / Forbidden.RAM）
    const e = err as { code?: string; message?: string }
    logger.error('[bss] 查询账户余额失败:', err)
    void logCloudServiceCall({
      service: 'bss',
      operation: 'queryAccountBalance',
      success: false,
      durationMs: callStart ? Date.now() - callStart : 0,
      errorMessage: (e?.code ? `${e.code}: ${e.message ?? ''}` : String(err)).substring(0, 500),
    })
    return {
      success: false,
      error: e?.code ? `${e.code}: ${e.message ?? ''}` : String(err),
    }
  }
}

// ==================== 账单查询（管理后台云服务模块） ====================

/** 账单查询结果 */
export interface BillResult {
  success: boolean
  billingCycle?: string
  totalCount?: number
  items?: {
    productCode: string
    productName: string
    subscriptionType: string
    pretaxAmount: number
    deductedByCoupons: number
    paymentAmount: number
  }[]
  error?: string
}

/**
 * 查询指定账期的账单明细。
 * 【探索性质】QueryBill 文档不全，失败时返回 success=false + error，绝不抛异常。
 * @param billingCycle 账期，格式 YYYY-MM（如 2026-07）
 */
export async function queryBill(billingCycle: string): Promise<BillResult> {
  const client = getClient()
  if (!client) {
    return { success: false, error: 'BSS AccessKey 未配置' }
  }
  let callStart = 0
  try {
    callStart = Date.now()
    const res = (await client.request('QueryBill', {
      BillingCycle: billingCycle,
      PageSize: 100,
      PageNum: 1,
    })) as {
      Data?: {
        TotalCount?: number
        Items?: {
          Item?: {
            ProductCode?: string
            ProductName?: string
            SubscriptionType?: string
            PretaxAmount?: number
            DeductedByCoupons?: number
            PaymentAmount?: number
          }[]
        }
      }
    }
    const data = res?.Data
    if (!data) {
      return { success: false, error: 'BSS 响应结构异常（无 Data 字段）' }
    }
    const rawItems = data.Items?.Item ?? []
    void logCloudServiceCall({
      service: 'bss',
      operation: 'queryBill',
      success: true,
      durationMs: Date.now() - callStart,
    })
    return {
      success: true,
      billingCycle,
      totalCount: data.TotalCount ?? rawItems.length,
      items: rawItems.map((i) => ({
        productCode: i.ProductCode ?? '',
        productName: i.ProductName ?? '',
        subscriptionType: i.SubscriptionType ?? '',
        pretaxAmount: Number(i.PretaxAmount ?? 0),
        deductedByCoupons: Number(i.DeductedByCoupons ?? 0),
        paymentAmount: Number(i.PaymentAmount ?? 0),
      })),
    }
  } catch (err) {
    const e = err as { code?: string; message?: string }
    logger.error('[bss] 查询账单失败:', err)
    void logCloudServiceCall({
      service: 'bss',
      operation: 'queryBill',
      success: false,
      durationMs: callStart ? Date.now() - callStart : 0,
      errorMessage: (e?.code ? `${e.code}: ${e.message ?? ''}` : String(err)).substring(0, 500),
    })
    return {
      success: false,
      error: e?.code ? `${e.code}: ${e.message ?? ''}` : String(err),
    }
  }
}

// ==================== 账单总览 / 代金券 / 预付卡 / 月度趋势 ====================
// 【探索性质】以下接口文档不全，均 try/catch 结构化降级，绝不抛异常。
// 为避免每次页面加载都请求外部 BSS API，加进程内缓存（镜像 deepseek.ts）：
// 当月账期 5 分钟 TTL，历史账期不可变用长 TTL。

/** 通用缓存条目 */
interface BssCacheEntry {
  data: unknown
  expireAt: number
}
const CACHE_TTL_MS = 5 * 60 * 1000
/** 历史账期（非当月）不可变，用长 TTL */
const CACHE_TTL_LONG_MS = 24 * 60 * 60 * 1000
const bssCache = new Map<string, BssCacheEntry>()

function getCached<T>(key: string): T | null {
  const hit = bssCache.get(key)
  if (hit && Date.now() < hit.expireAt) return hit.data as T
  return null
}
function setCached(key: string, data: unknown, ttl = CACHE_TTL_MS): void {
  // 简单容量保护（BSS 键极少，仅按账期/操作维度）
  if (bssCache.size > 200) bssCache.clear()
  bssCache.set(key, { data, expireAt: Date.now() + ttl })
}

/** 当前账期 YYYY-MM */
function currentCycle(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

/** 账单总览结果（按产品汇总） */
export interface BillOverviewResult {
  success: boolean
  billingCycle?: string
  items?: {
    productCode: string
    productName: string
    pretaxAmount: number
    deductedByCoupons: number
    paymentAmount: number
  }[]
  error?: string
}

/**
 * 查询指定账期的账单总览（按产品汇总，QueryBillOverview）。
 * 成功结果按账期缓存（当月 5 分钟、历史 24 小时）。
 */
export async function queryBillOverview(billingCycle: string): Promise<BillOverviewResult> {
  const cacheKey = `overview:${billingCycle}`
  const cached = getCached<BillOverviewResult>(cacheKey)
  if (cached) return cached

  const client = getClient()
  if (!client) return { success: false, error: 'BSS AccessKey 未配置' }
  let callStart = 0
  try {
    callStart = Date.now()
    const res = (await client.request('QueryBillOverview', {
      BillingCycle: billingCycle,
    })) as {
      Data?: {
        Items?: {
          Item?: {
            ProductCode?: string
            ProductName?: string
            PretaxAmount?: number
            DeductedByCoupons?: number
            PaymentAmount?: number
          }[]
        }
      }
    }
    const data = res?.Data
    if (!data) return { success: false, error: 'BSS 响应结构异常（无 Data 字段）' }
    const rawItems = data.Items?.Item ?? []
    void logCloudServiceCall({
      service: 'bss',
      operation: 'queryBillOverview',
      success: true,
      durationMs: Date.now() - callStart,
    })
    // 同产品可能多行（按 BillingItem 拆分），按 ProductCode 合并
    const merged = new Map<string, NonNullable<BillOverviewResult['items']>[number]>()
    for (const i of rawItems) {
      const code = i.ProductCode ?? ''
      const prev = merged.get(code) ?? {
        productCode: code,
        productName: i.ProductName ?? code,
        pretaxAmount: 0,
        deductedByCoupons: 0,
        paymentAmount: 0,
      }
      prev.pretaxAmount += Number(i.PretaxAmount ?? 0)
      prev.deductedByCoupons += Number(i.DeductedByCoupons ?? 0)
      prev.paymentAmount += Number(i.PaymentAmount ?? 0)
      merged.set(code, prev)
    }
    const result: BillOverviewResult = {
      success: true,
      billingCycle,
      items: [...merged.values()].sort((a, b) => b.paymentAmount - a.paymentAmount),
    }
    setCached(cacheKey, result, billingCycle === currentCycle() ? CACHE_TTL_MS : CACHE_TTL_LONG_MS)
    return result
  } catch (err) {
    const e = err as { code?: string; message?: string }
    logger.error('[bss] 查询账单总览失败:', err)
    void logCloudServiceCall({
      service: 'bss',
      operation: 'queryBillOverview',
      success: false,
      durationMs: callStart ? Date.now() - callStart : 0,
      errorMessage: (e?.code ? `${e.code}: ${e.message ?? ''}` : String(err)).substring(0, 500),
    })
    return { success: false, error: e?.code ? `${e.code}: ${e.message ?? ''}` : String(err) }
  }
}

/** 代金券查询结果 */
export interface CashCouponsResult {
  success: boolean
  items?: {
    cashCouponId: string
    nominalValue: string
    balance: string
    expiryTime: string
    status: string
    applicableProducts: string
  }[]
  error?: string
}

/** 查询有效代金券（QueryCashCoupons）。缓存 5 分钟。 */
export async function queryCashCoupons(): Promise<CashCouponsResult> {
  const cacheKey = 'coupons'
  const cached = getCached<CashCouponsResult>(cacheKey)
  if (cached) return cached

  const client = getClient()
  if (!client) return { success: false, error: 'BSS AccessKey 未配置' }
  let callStart = 0
  try {
    callStart = Date.now()
    const res = (await client.request('QueryCashCoupons', {
      EffectiveOrNot: true,
    })) as {
      Data?: {
        CashCoupon?: {
          CashCouponId?: number | string
          NominalValue?: string
          Balance?: string
          ExpiryTime?: string
          Status?: string
          ApplicableProducts?: string
        }[]
      }
    }
    const rawItems = res?.Data?.CashCoupon ?? []
    void logCloudServiceCall({
      service: 'bss',
      operation: 'queryCashCoupons',
      success: true,
      durationMs: Date.now() - callStart,
    })
    const result: CashCouponsResult = {
      success: true,
      items: rawItems.map((i) => ({
        cashCouponId: String(i.CashCouponId ?? ''),
        nominalValue: String(i.NominalValue ?? ''),
        balance: String(i.Balance ?? ''),
        expiryTime: i.ExpiryTime ?? '',
        status: i.Status ?? '',
        applicableProducts: i.ApplicableProducts ?? '',
      })),
    }
    setCached(cacheKey, result)
    return result
  } catch (err) {
    const e = err as { code?: string; message?: string }
    logger.error('[bss] 查询代金券失败:', err)
    void logCloudServiceCall({
      service: 'bss',
      operation: 'queryCashCoupons',
      success: false,
      durationMs: callStart ? Date.now() - callStart : 0,
      errorMessage: (e?.code ? `${e.code}: ${e.message ?? ''}` : String(err)).substring(0, 500),
    })
    return { success: false, error: e?.code ? `${e.code}: ${e.message ?? ''}` : String(err) }
  }
}

/** 预付卡查询结果 */
export interface PrepaidCardsResult {
  success: boolean
  items?: {
    prepaidCardId: string
    nominalValue: string
    balance: string
    expiryTime: string
    applicableProducts: string
  }[]
  error?: string
}

/** 查询预付卡/储值卡（QueryPrepaidCards）。缓存 5 分钟。 */
export async function queryPrepaidCards(): Promise<PrepaidCardsResult> {
  const cacheKey = 'prepaidCards'
  const cached = getCached<PrepaidCardsResult>(cacheKey)
  if (cached) return cached

  const client = getClient()
  if (!client) return { success: false, error: 'BSS AccessKey 未配置' }
  let callStart = 0
  try {
    callStart = Date.now()
    const res = (await client.request('QueryPrepaidCards', {})) as {
      Data?: {
        PrepaidCard?: {
          PrepaidCardId?: number | string
          NominalValue?: string
          Balance?: string
          ExpiryTime?: string
          ApplicableProducts?: string
        }[]
      }
    }
    const rawItems = res?.Data?.PrepaidCard ?? []
    void logCloudServiceCall({
      service: 'bss',
      operation: 'queryPrepaidCards',
      success: true,
      durationMs: Date.now() - callStart,
    })
    const result: PrepaidCardsResult = {
      success: true,
      items: rawItems.map((i) => ({
        prepaidCardId: String(i.PrepaidCardId ?? ''),
        nominalValue: String(i.NominalValue ?? ''),
        balance: String(i.Balance ?? ''),
        expiryTime: i.ExpiryTime ?? '',
        applicableProducts: i.ApplicableProducts ?? '',
      })),
    }
    setCached(cacheKey, result)
    return result
  } catch (err) {
    const e = err as { code?: string; message?: string }
    logger.error('[bss] 查询预付卡失败:', err)
    void logCloudServiceCall({
      service: 'bss',
      operation: 'queryPrepaidCards',
      success: false,
      durationMs: callStart ? Date.now() - callStart : 0,
      errorMessage: (e?.code ? `${e.code}: ${e.message ?? ''}` : String(err)).substring(0, 500),
    })
    return { success: false, error: e?.code ? `${e.code}: ${e.message ?? ''}` : String(err) }
  }
}

/** 月度消费趋势结果 */
export interface MonthlyTrendResult {
  success: boolean
  items?: { billingCycle: string; pretaxAmount: number; paymentAmount: number }[]
  error?: string
}

/**
 * 查询近 N 个月消费趋势（循环 QueryBillOverview 汇总每月应付/实付）。
 * N 上限 6，避免过多外部调用；各月并行且复用 queryBillOverview 的缓存。
 */
export async function queryMonthlySpendTrend(months: number): Promise<MonthlyTrendResult> {
  const n = Math.max(1, Math.min(6, months))
  const cycles: string[] = []
  const now = new Date()
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    cycles.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  try {
    const overviews = await Promise.all(cycles.map((c) => queryBillOverview(c)))
    const items = overviews.map((ov, idx) => {
      const cycle = cycles[idx]!
      if (!ov.success || !ov.items) {
        return { billingCycle: cycle, pretaxAmount: 0, paymentAmount: 0 }
      }
      const pretax = ov.items.reduce((s, i) => s + i.pretaxAmount, 0)
      const payment = ov.items.reduce((s, i) => s + i.paymentAmount, 0)
      return {
        billingCycle: cycle,
        pretaxAmount: Math.round(pretax * 100) / 100,
        paymentAmount: Math.round(payment * 100) / 100,
      }
    })
    // 若全部月份都失败（如无权限），返回降级
    const anySuccess = overviews.some((o) => o.success)
    if (!anySuccess) {
      return { success: false, error: overviews[0]?.error || '账单总览不可用' }
    }
    return { success: true, items }
  } catch (err) {
    logger.error('[bss] 查询月度趋势失败:', err)
    return { success: false, error: String(err) }
  }
}
