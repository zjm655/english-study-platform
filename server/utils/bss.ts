// server/utils/bss.ts
// 阿里云 BSS（费用中心）用量查询工具。
//
// 【探索性质】阿里云官方文档/示例不全，本封装以 QueryAccountBalance（账户余额）为切入点，
// 全部调用以 try/catch 包裹，失败时返回结构化错误而非抛异常，保证管理后台可优雅降级展示。
// 后续如需账单明细（QueryBill / DescribeInstanceBill）可按同模式扩展。

import RPCClient from '@alicloud/pop-core'
import { logCloudServiceCall } from './cloudServiceLog'

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
  try {
    let callStart = 0
    callStart = Date.now()
    const res = await client.request('QueryAccountBalance', {}) as {
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
    void logCloudServiceCall({ service: 'bss', operation: 'queryAccountBalance', success: true, durationMs: Date.now() - callStart })
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
    void logCloudServiceCall({ service: 'bss', operation: 'queryAccountBalance', success: false, durationMs: callStart ? Date.now() - callStart : 0, errorMessage: (e?.code ? `${e.code}: ${e.message ?? ''}` : String(err)).substring(0, 500) })
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
  try {
    let callStart = 0
    callStart = Date.now()
    const res = await client.request('QueryBill', {
      BillingCycle: billingCycle,
      PageSize: 100,
      PageNum: 1,
    }) as {
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
    void logCloudServiceCall({ service: 'bss', operation: 'queryBill', success: true, durationMs: Date.now() - callStart })
    return {
      success: true,
      billingCycle,
      totalCount: data.TotalCount ?? rawItems.length,
      items: rawItems.map(i => ({
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
    void logCloudServiceCall({ service: 'bss', operation: 'queryBill', success: false, durationMs: callStart ? Date.now() - callStart : 0, errorMessage: (e?.code ? `${e.code}: ${e.message ?? ''}` : String(err)).substring(0, 500) })
    return {
      success: false,
      error: e?.code ? `${e.code}: ${e.message ?? ''}` : String(err),
    }
  }
}
