// server/services/deepseek.ts
// DeepSeek 账户余额查询工具。
//
// 复用 runtimeConfig.deepseek（apiKey + baseUrl），通过 Bearer Token 认证调用
// GET /user/balance 接口。带 5 分钟内存缓存（余额变化极低频，跨洋 API 延迟高）。
// 失败时返回结构化错误而非抛异常，保证管理后台可优雅降级展示。

import { serverFetch } from '#server/utils/request'
import { fileLog, fileLogError } from '#server/utils/fileLogger'
import { logCloudServiceCall } from '#server/utils/cloudServiceLog'
import type { DeepSeekBalanceResult, DeepSeekBalanceInfo } from '#shared/types/adminCloud'

/** DeepSeek 配置结构 */
interface DeepSeekConfig {
  apiKey: string
  baseUrl: string
}

/** 缓存 TTL（毫秒） */
const CACHE_TTL = 5 * 60 * 1000

/** 内存缓存 */
let cached: { data: DeepSeekBalanceResult; expireAt: number } | null = null

/**
 * 查询 DeepSeek 账户余额。
 * 失败（配置缺失 / 网络异常 / API 变更）时返回 success=false + error，绝不抛异常。
 */
export async function getDeepSeekBalance(): Promise<DeepSeekBalanceResult> {
  // 1. 检查缓存
  if (cached && Date.now() < cached.expireAt) {
    return cached.data
  }

  // 2. 读取配置
  const config = useRuntimeConfig()
  const ds = config.deepseek as unknown as DeepSeekConfig

  if (!ds?.apiKey || !ds?.baseUrl) {
    return { success: false, error: 'DeepSeek 配置缺失（apiKey / baseUrl）' }
  }

  // 3. 调用余额接口
  const url = `${ds.baseUrl.replace(/\/+$/, '')}/user/balance`

  let callStart = 0
  try {
    callStart = Date.now()
    const resp = await serverFetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${ds.apiKey}`,
      },
      timeout: 10_000,
      tag: '[deepseek]',
    })

    if (!resp.ok) {
      const body = await resp.text()
      logger.error(`[deepseek] 余额查询返回 ${resp.status}: ${body}`)
      fileLogError('ai', '[deepseek] 余额查询失败', `HTTP ${resp.status}`)
      void logCloudServiceCall({
        service: 'deepseek',
        operation: 'checkBalance',
        success: false,
        durationMs: Date.now() - callStart,
        errorMessage: `HTTP ${resp.status}`,
      })
      return { success: false, error: `DeepSeek API 返回 ${resp.status}` }
    }

    const data = (await resp.json()) as {
      is_available?: boolean
      balance_infos?: {
        currency?: string
        total_balance?: string
        granted_balance?: string
        topped_up_balance?: string
      }[]
    }

    // 4. 解析响应
    const balances: DeepSeekBalanceInfo[] = Array.isArray(data.balance_infos)
      ? data.balance_infos.map((b) => ({
          currency: b.currency ?? 'CNY',
          totalBalance: b.total_balance ?? '0',
          grantedBalance: b.granted_balance ?? '0',
          toppedUpBalance: b.topped_up_balance ?? '0',
        }))
      : []

    const result: DeepSeekBalanceResult = {
      success: true,
      isAvailable: data.is_available ?? true,
      balances,
    }

    // 5. 写入缓存
    cached = { data: result, expireAt: Date.now() + CACHE_TTL }

    fileLog('ai', 'info', '[deepseek] 余额查询成功', {
      isAvailable: result.isAvailable,
      count: balances.length,
    })
    void logCloudServiceCall({
      service: 'deepseek',
      operation: 'checkBalance',
      success: true,
      durationMs: Date.now() - callStart,
    })
    return result
  } catch (err) {
    const e = err as { message?: string }
    void logCloudServiceCall({
      service: 'deepseek',
      operation: 'checkBalance',
      success: false,
      durationMs: callStart ? Date.now() - callStart : 0,
      errorMessage: String(e?.message ?? err).substring(0, 500),
    })
    logger.error('[deepseek] 余额查询异常:', err)
    fileLogError('ai', '[deepseek] 余额查询异常', e?.message ?? String(err))
    return {
      success: false,
      error: e?.message?.includes('timeout') ? 'DeepSeek 余额查询超时' : 'DeepSeek 余额查询失败',
    }
  }
}
