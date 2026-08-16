import { getQueueStats, syncServiceQueueConcurrency } from '#server/services/serviceQueue'
import { getEvalGateSnapshot } from '#server/utils/quotaChecker'
import { fetchUploadTaskStats } from '#server/services/materialRecordStatus'
import { getSttMonitorSnapshot } from '#server/services/sttFiletrans'
import { getApiCallLogStats } from '#server/utils/apiCallLog'
import { getCloudServiceLogStats } from '#server/utils/cloudServiceLog'
import { getRateLimiterStats } from '#server/utils/rateLimiter'
import { query } from '#server/utils/db'
import { validateSuccess } from '#server/utils/validate'
import { ensurePermission } from '#server/services/permission'
import { PERMISSIONS } from '#shared/utils/permission'
import type { AdminMonitorSnapshot, AlertEventSummary } from '#shared/types/adminMonitor'

/** 事件聚合缓存：60s TTL（事件低频变化，5s 轮询不放大 DB 查询） */
const EVENT_CACHE_TTL_MS = 60_000
let eventCache: { data: AlertEventSummary; expireAt: number } | null = null

/** 近 1 小时告警事件统计 + 最近 5 条摘要（60s 缓存；查询失败降级空数据不阻断监控） */
async function fetchAlertEvents(): Promise<AlertEventSummary> {
  const now = Date.now()
  if (eventCache && now < eventCache.expireAt) return eventCache.data
  try {
    const [countRows, recentRows] = await Promise.all([
      query<{ source: string; cnt: number | string }>(
        `SELECT source, COUNT(*) AS cnt FROM alert_event
         WHERE createdAt >= DATE_SUB(NOW(), INTERVAL 1 HOUR)
         GROUP BY source`,
      ),
      query<{
        id: number
        source: string
        level: string
        code: string | null
        message: string | null
        createdAt: string
      }>(
        `SELECT id, source, level, code, message, createdAt FROM alert_event
         ORDER BY createdAt DESC LIMIT 5`,
      ),
    ])
    const data: AlertEventSummary = {
      countsBySource: Object.fromEntries(countRows.map((r) => [r.source, Number(r.cnt ?? 0)])),
      recent: recentRows.map((r) => ({
        id: r.id,
        source: r.source,
        level: r.level,
        code: r.code,
        message: r.message,
        createdAt: r.createdAt,
      })),
    }
    eventCache = { data, expireAt: now + EVENT_CACHE_TTL_MS }
    return data
  } catch {
    // 事件查询失败不影响监控主流程（旁路）
    return { countsBySource: {}, recent: [] }
  }
}

/**
 * 运行监控聚合快照（取代原 GET /api/admin/queues）
 * GET /api/admin/monitor
 *
 * 五块进程内实时状态：云产品队列水位 / 评测闸门活跃数 / 上传任务分布 /
 * 埋点缓冲水位 / 限流滑窗 + 告警事件（近 1 小时计数 + 最近 5 条，60s 缓存）。
 * 仅两条走索引的轻查询 + 内存读；单机内存态口径：多实例部署时快照仅反映本实例。
 */
export default defineEventHandler(
  async (event): Promise<ResPayload<AdminMonitorSnapshot | null>> => {
    const err = ensurePermission(event, PERMISSIONS.CONFIG)
    if (err) return err

    // 先同步并发配置到队列实例（冷启动未发生过云调用时队列还是初始 Infinity，
    // 直接读会误报「不限流」）；走 5min TTL 缓存，5s 轮询不放大查询
    const [evalGate, uploadTasks, stt, alertEvents] = await Promise.all([
      getEvalGateSnapshot(),
      fetchUploadTaskStats(),
      getSttMonitorSnapshot(),
      fetchAlertEvents(),
      syncServiceQueueConcurrency(),
    ])

    return validateSuccess<AdminMonitorSnapshot>({
      queues: getQueueStats(),
      evalGate,
      uploadTasks,
      buffers: [
        { name: 'apiCallLog', ...getApiCallLogStats() },
        { name: 'cloudServiceLog', ...getCloudServiceLogStats() },
      ],
      rateLimiter: getRateLimiterStats(),
      stt,
      alertEvents,
      serverTime: new Date().toISOString(),
    })
  },
)
