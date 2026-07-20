// server/utils/cloudEstimate.ts
// 云产品本地埋点估算引擎。
//
// 基于 api_call_log 表的调用记录，按产品关联路径统计调用次数 × 单价，
// 得出估算费用。仅供管理后台参考，非精确计费数据。
//
// 【产品注册表】新增云产品只需在 PRODUCT_REGISTRY 追加一条配置。

import { query } from './db'
import type { CloudEstimateSummary, CloudPathEstimate } from '#shared/types/adminCloud'

/** 路径配置 */
interface PathConfig {
  /** 匹配路径（exact=false 时作为 LIKE 模式） */
  path: string
  /** HTTP 方法 */
  method: string
  /** 是否精确匹配（false 则用 LIKE，适用于含动态 ID 的路径） */
  exact: boolean
}

/** 产品估算配置 */
interface ProductConfig {
  name: string
  unit: string
  unitPrice: number
  paths: PathConfig[]
}

/** 产品估算配置注册表（集中维护埋点路径与单价，改一处即可） */
const PRODUCT_REGISTRY: Record<string, ProductConfig> = {
  oss: {
    name: 'OSS 对象存储',
    unit: '次',
    unitPrice: 0.0001, // Put 请求费 0.01 元/万次
    paths: [
      { path: '/api/recording', method: 'POST', exact: true },
    ],
  },
  nls: {
    name: 'NLS 智能语音交互',
    unit: '次',
    unitPrice: 0.083, // 每次约 2 分钟音频 × 2.5 元/小时 ≈ 0.083 元
    paths: [
      { path: '/api/segment/upload', method: 'POST', exact: true },
      { path: '/api/recording', method: 'POST', exact: true }, // 录音上传也触发 ASR 校对
    ],
  },
  edu: {
    name: '智能科教平台',
    unit: '次',
    unitPrice: 0.004, // 0.004 元/次
    paths: [
      { path: '/api/evaluation/auth', method: 'POST', exact: true },
      { path: '/api/recording/%/analyze', method: 'POST', exact: false }, // 含动态 ID
    ],
  },
}

export type CloudProductKey = keyof typeof PRODUCT_REGISTRY

/**
 * 估算指定云产品在给定时间范围内的调用量与费用。
 * 逐路径查询后汇总（路径数 ≤3，无需复杂条件聚合）。
 */
export async function estimateServiceUsage(
  product: CloudProductKey,
  days: number
): Promise<CloudEstimateSummary> {
  const config = PRODUCT_REGISTRY[product]
  if (!config) {
    return { totalCalls: 0, totalEstimatedCost: 0, unitPrice: 0, unit: '次', byPath: [], days }
  }

  const byPath: CloudPathEstimate[] = []
  let totalCalls = 0

  for (const p of config.paths) {
    // 时间条件强制走 idx_path_created 索引
    const timeCond = 'createdAt >= DATE_SUB(CURDATE(), INTERVAL ? DAY)'
    const pathCond = p.exact
      ? 'path = ? AND method = ?'
      : 'path LIKE ? AND method = ?'

    const sql = `SELECT COUNT(*) AS cnt FROM api_call_log WHERE ${timeCond} AND ${pathCond}`
    const rows = await query<{ cnt: number | string }>(sql, [days, p.path, p.method])
    const count = Number(rows[0]?.cnt ?? 0)

    totalCalls += count
    byPath.push({
      path: p.path,
      method: p.method,
      count,
      unitPrice: config.unitPrice,
      estimatedCost: Math.round(count * config.unitPrice * 1000) / 1000,
    })
  }

  return {
    totalCalls,
    totalEstimatedCost: Math.round(totalCalls * config.unitPrice * 1000) / 1000,
    unitPrice: config.unitPrice,
    unit: config.unit,
    byPath,
    days,
  }
}
