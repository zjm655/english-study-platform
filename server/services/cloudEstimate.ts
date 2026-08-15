// server/services/cloudEstimate.ts
// 云产品本地埋点估算引擎。
//
// 基于 api_call_log 的调用记录，按产品关联路径统计调用次数 × 单价得出估算费用。
// 仅供管理后台参考，非精确计费数据。
//
// 精确化要点（仅依赖现有埋点，不新增采集维度）：
// - 单条分组聚合查询（GROUP BY route_pattern, method）替代逐路径 N 次 COUNT，配合
//   迁移 016 的 (route_pattern, method, createdAt) 复合索引走索引过滤。
// - 计费口径区分成功/失败：默认仅成功调用（status_code < 400）计费——失败请求多在调用
//   云服务前就已返回，不产生外部费用。
// - 支持按路径覆盖单价（priceOverride），刻画不同端点触发的云调用成本差异。
//
// 【产品注册表】新增云产品只需在 PRODUCT_REGISTRY 追加一条配置。

import { query } from '#server/utils/db'
import type { CloudEstimateSummary, CloudPathEstimate } from '#shared/types/adminCloud'

/** 计费口径 */
type StatusFilter = 'success' | 'failure' | 'all'

/** 路径配置 */
interface PathConfig {
  /** 路由模式（如 /api/recording），用于匹配 api_call_log.route_pattern */
  pattern: string
  /** HTTP 方法 */
  method: string
  /** 展示名（未设则回退 pattern） */
  label?: string
  /** 单价覆盖（元/次），未设则用产品默认 unitPrice */
  priceOverride?: number
  /** 计费口径，默认仅成功计费 */
  statusFilter?: StatusFilter
}

/** 产品估算配置 */
interface ProductConfig {
  name: string
  unit: string
  unitPrice: number
  paths: PathConfig[]
}

// NLS 计费：录音文件识别（filetrans）/ 极速版（FlashRecognizer）官方按音频时长计费（约 2.5 元/小时）。
// 本项目不再按次折算——埋点已带真实音频时长 biz_duration_ms（filetrans 的 BizDuration / flash 的 duration），
// 直接 SUM 时长 × 单价，口径与官方账单一致。
// 注意：api_call_log 路径聚合已废弃（管理员上传与录音上传均不触发 NLS，仅用户材料上传走 STT），
// 真实调用从 cloud_service_call_log 统计（service='nls' AND success=1 AND operation IN (filetrans, speechToText)）。
const NLS_PRICE_PER_HOUR = 2.5

// OSS 外网下行计费：上传流入（内外网）免费、内网流出免费，仅外网流出（前端签名 URL 直连
// 播放）收费——这是 OSS 唯一实际成本，却完全绕过 api_call_log。故放弃「上传内外网区分」
// （零成本洞察），改由 oss_playback_daily 统计播放次数，以「平均音频体积」常量系数折算下行费用。
// 单价取官方忙时第一阶梯价 0.50 元/GB（闲时约半价），偏保守估算上限；精确流量以 BSS 账单为准。
const OSS_OUTBOUND_PRICE_PER_GB = 0.5
const OSS_AVG_AUDIO_MB = 1.5 // 单次音频平均约 1.5 MB
/** 每次播放的外网下行估算单价（元/次）：平均体积(GB) × 单价(元/GB)，保留 6 位避免展示拖尾 */
const OSS_PLAYBACK_UNIT_PRICE =
  Math.round((OSS_AVG_AUDIO_MB / 1024) * OSS_OUTBOUND_PRICE_PER_GB * 1e6) / 1e6

/** 产品估算配置注册表（集中维护埋点路径与单价，改一处即可） */
const PRODUCT_REGISTRY: Record<string, ProductConfig> = {
  oss: {
    name: 'OSS 对象存储',
    unit: '次',
    unitPrice: 0.000001, // Put 请求费 0.01 元/万次 = 0.000001 元/次
    paths: [
      // OSS 写入（PUT）：上传成功才产生对象写入费；OSS 读取（回放）由浏览器经签名 URL
      // 直连 OSS，不经本服务，故 api_call_log 无读请求记录，此处仅覆盖写入维度。
      { pattern: '/api/recording', method: 'POST', label: '录音上传 (PUT)' },
      { pattern: '/api/segment/upload', method: 'POST', label: '用户材料上传 (PUT)' },
      { pattern: '/api/admin/segment/upload', method: 'POST', label: '管理员材料上传 (PUT)' },
    ],
  },
  // NLS 不走 api_call_log 路径聚合（见 estimateNlsUsage 专用分支），注册表仅保留展示信息。
  nls: {
    name: 'NLS 智能语音交互',
    unit: '小时',
    unitPrice: NLS_PRICE_PER_HOUR,
    paths: [],
  },
  // edu 走 cloud_service_call_log 精确统计（P2 起，见 estimateEduUsage 专用分支），
  // 注册表仅保留展示信息（单价/名称），paths 清空避免走 api_call_log 路径聚合。
  edu: {
    name: '智能科教平台',
    unit: '次',
    unitPrice: 0.004, // 0.004 元/次（失败不计费）
    paths: [],
  },
}

export type CloudProductKey = keyof typeof PRODUCT_REGISTRY

/** 分组聚合行 */
interface AggRow {
  route_pattern: string
  method: string
  ok_cnt: number | string
  fail_cnt: number | string
}

/**
 * 估算指定云产品在给定时间范围内的调用量与费用。
 * 单条分组聚合查询（GROUP BY route_pattern, method）后按路径配置映射，避免逐路径 N 次查询。
 */
export async function estimateServiceUsage(
  product: CloudProductKey,
  days: number,
): Promise<CloudEstimateSummary> {
  // NLS 专用分支：基于 cloud_service_call_log 的真实调用统计（含音频时长），不走 api_call_log 路径聚合
  if (product === 'nls') {
    return estimateNlsUsage(days)
  }

  // edu 专用分支：基于 cloud_service_call_log（P1-D 起 service='edu' 埋点）精确统计
  if (product === 'edu') {
    return estimateEduUsage(days)
  }

  const config = PRODUCT_REGISTRY[product]
  if (!config || config.paths.length === 0) {
    return { totalCalls: 0, totalEstimatedCost: 0, unitPrice: 0, unit: '次', byPath: [], days }
  }

  const patterns = [...new Set(config.paths.map((p) => p.pattern))]
  const methods = [...new Set(config.paths.map((p) => p.method))]
  const patternPlaceholders = patterns.map(() => '?').join(', ')
  const methodPlaceholders = methods.map(() => '?').join(', ')

  // 时间条件强制走索引；route_pattern + method 借迁移 016 的复合索引过滤
  const sql = `SELECT route_pattern, method,
                 SUM(status_code < 400) AS ok_cnt,
                 SUM(status_code >= 400) AS fail_cnt
               FROM api_call_log
               WHERE createdAt >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
                 AND route_pattern IN (${patternPlaceholders})
                 AND method IN (${methodPlaceholders})
               GROUP BY route_pattern, method`

  const rows = await query<AggRow>(sql, [days, ...patterns, ...methods])

  // (route_pattern|method) -> { ok, fail }
  const counts = new Map<string, { ok: number; fail: number }>()
  for (const r of rows) {
    counts.set(`${r.route_pattern}|${r.method}`, {
      ok: Number(r.ok_cnt ?? 0),
      fail: Number(r.fail_cnt ?? 0),
    })
  }

  const byPath: CloudPathEstimate[] = []
  let totalCalls = 0
  let totalEstimatedCost = 0

  for (const p of config.paths) {
    const c = counts.get(`${p.pattern}|${p.method}`) ?? { ok: 0, fail: 0 }
    const filter: StatusFilter = p.statusFilter ?? 'success'
    const count = filter === 'all' ? c.ok + c.fail : filter === 'failure' ? c.fail : c.ok
    const unitPrice = p.priceOverride ?? config.unitPrice
    const estimatedCost = Math.round(count * unitPrice * 1000) / 1000

    totalCalls += count
    totalEstimatedCost += estimatedCost
    byPath.push({
      path: p.pattern,
      label: p.label,
      method: p.method,
      count,
      unitPrice,
      estimatedCost,
    })
  }

  // OSS 外网播放（下行）：数据源是有界日汇总表 oss_playback_daily（非 api_call_log），
  // 在标准 byPath 之外「增量」追加一行——外网下行是 OSS 唯一实际计费项。
  // 汇总表缺失或查询异常时降级为 0，不影响其余 OSS 估算行（埋点为旁路能力）。
  if (product === 'oss') {
    let playCount = 0
    try {
      const playRows = await query<{ cnt: number | string }>(
        `SELECT COALESCE(SUM(play_count), 0) AS cnt
         FROM oss_playback_daily
         WHERE stat_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)`,
        [days],
      )
      playCount = Number(playRows[0]?.cnt ?? 0)
    } catch {
      // oss_playback_daily 缺失或查询失败时按 0 计，不阻断整体 OSS 估算
    }
    const playCost = Math.round(playCount * OSS_PLAYBACK_UNIT_PRICE * 1000) / 1000
    totalCalls += playCount
    totalEstimatedCost += playCost
    byPath.push({
      path: '/api/oss/playback',
      label: '前端播放 (外网下行·估算)',
      method: 'GET',
      count: playCount,
      unitPrice: OSS_PLAYBACK_UNIT_PRICE,
      estimatedCost: playCost,
    })
  }

  return {
    totalCalls,
    totalEstimatedCost: Math.round(totalEstimatedCost * 1000) / 1000,
    unitPrice: config.unitPrice,
    unit: config.unit,
    byPath,
    days,
  }
}

/**
 * edu 用量统计（P2 起，口径切换点 2026-08-15 P1-D 落地）：基于 cloud_service_call_log 精确统计。
 *
 * 计费口径：评测鉴权（operation='warrant'）成功调用 0.004 元/次（失败不计费）。
 * - 计入：service='edu' AND operation='warrant' AND success=1；
 * - 历史断层：cloud_service_call_log 的 edu 数据自 P1-D 起才有，切换前历史不可比（页面已注明）。
 */
async function estimateEduUsage(days: number): Promise<CloudEstimateSummary> {
  const config = PRODUCT_REGISTRY.edu!
  const [row] = await query<{ ok: number | string }>(
    `SELECT SUM(success = 1) AS ok
     FROM cloud_service_call_log
     WHERE service = 'edu' AND operation = 'warrant'
       AND createdAt >= DATE_SUB(CURDATE(), INTERVAL ? DAY)`,
    [days],
  )
  const ok = Number(row?.ok ?? 0)
  const unitPrice = config.unitPrice
  const cost = Math.round(ok * unitPrice * 1000) / 1000

  return {
    totalCalls: ok,
    totalEstimatedCost: cost,
    unitPrice,
    unit: config.unit,
    byPath: [
      {
        path: '/api/evaluation/auth',
        label: '口语评测鉴权 (warrant)',
        method: 'POST',
        count: ok,
        unitPrice,
        estimatedCost: cost,
      },
    ],
    days,
  }
}

/**
 * NLS 用量估算：真实调用（cloud_service_call_log）按音频时长计费。
 *
 * 计费口径（官方）：录音文件识别/极速版识别按「音频时长」计费，约 2.5 元/小时。
 * - 计入：success=1 且 operation ∈ {filetrans（标准版）, speechToText（极速版）} 的识别调用；
 *   费用 = SUM(biz_duration_ms) / 3600000 × 2.5。
 * - 不计入：createToken（鉴权换取 token，非计费调用）、sttFallback（回退诊断行）、失败调用。
 * - 免费额度：filetrans 标准版处于每日 2 小时免费试用期内时实际不计费，估算值为「按量价」上限。
 * - 误差：flash 极速版在 2026-07 前的埋点未记 biz_duration_ms，历史数据缺失部分按 0 时长计。
 */
async function estimateNlsUsage(days: number): Promise<CloudEstimateSummary> {
  const rows = await query<{
    operation: string
    call_count: number | string
    biz_ms: number | string
  }>(
    `SELECT operation,
            COUNT(*) AS call_count,
            COALESCE(SUM(biz_duration_ms), 0) AS biz_ms
     FROM cloud_service_call_log
     WHERE service = 'nls' AND success = 1
       AND operation IN ('filetrans', 'speechToText')
       AND createdAt >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
     GROUP BY operation`,
    [days],
  )

  const byPath: CloudPathEstimate[] = []
  let totalCalls = 0
  let totalBizMs = 0

  for (const row of rows) {
    const count = Number(row.call_count ?? 0)
    const bizMs = Number(row.biz_ms ?? 0)
    totalCalls += count
    totalBizMs += bizMs
    const hours = bizMs / 3_600_000
    byPath.push({
      path: `nls:${row.operation}`,
      label:
        row.operation === 'filetrans'
          ? '录音文件识别（标准版 filetrans）'
          : '极速版识别（FlashRecognizer）',
      method: 'POST',
      count,
      unitPrice: NLS_PRICE_PER_HOUR,
      estimatedCost: Math.round(hours * NLS_PRICE_PER_HOUR * 1000) / 1000,
      bizDurationMs: bizMs,
    })
  }

  // 无调用记录时按空结果返回（unit 仍为小时，页面展示口径一致）
  if (byPath.length === 0) {
    return {
      totalCalls: 0,
      totalEstimatedCost: 0,
      unitPrice: NLS_PRICE_PER_HOUR,
      unit: '小时',
      byPath,
      days,
      bizDurationMs: 0,
    }
  }

  const totalEstimatedCost = Math.round((totalBizMs / 3_600_000) * NLS_PRICE_PER_HOUR * 1000) / 1000
  return {
    totalCalls,
    totalEstimatedCost,
    unitPrice: NLS_PRICE_PER_HOUR,
    unit: '小时',
    byPath,
    days,
    bizDurationMs: totalBizMs,
  }
}
