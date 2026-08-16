import { query } from '#server/utils/db'
import { validateSuccess } from '#server/utils/validate'
import { ensurePermission } from '#server/services/permission'
import { PERMISSIONS } from '#shared/utils/permission'
import type { AlertEventSummary } from '#shared/types/alertEvents'

/**
 * 告警事件摘要（近 1 小时各来源计数 + 最近 5 条）
 * GET /api/admin/stats/alert-events
 *
 * 2026-08-16 自 monitor 快照迁出：告警事件属「运营统计」语义（事件低频变化），
 * 独立接口独立加载，不随 stats 的 7/30/90 天切换重拉；monitor 快照保持纯进程内实时状态。
 * 60s 缓存：事件低频变化，避免高频刷新放大 DB 查询；查询失败降级空数据不阻断。
 */
const EVENT_CACHE_TTL_MS = 60_000
let eventCache: { data: AlertEventSummary; expireAt: number } | null = null

export default defineEventHandler(async (event): Promise<ResPayload<AlertEventSummary | null>> => {
  const err = ensurePermission(event, PERMISSIONS.CONFIG)
  if (err) return err

  const now = Date.now()
  if (eventCache && now < eventCache.expireAt) {
    return validateSuccess(eventCache.data, '获取成功')
  }
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
    return validateSuccess(data, '获取成功')
  } catch {
    // 事件查询失败不影响主流程（旁路）
    return validateSuccess({ countsBySource: {}, recent: [] }, '获取成功')
  }
})
