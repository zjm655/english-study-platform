import { getQueueStats, syncServiceQueueConcurrency } from '#server/utils/serviceQueue'
import { getEvalGateSnapshot } from '#server/utils/quotaChecker'
import { fetchUploadTaskStats } from '#server/utils/materialRecordStatus'
import { getSttMonitorSnapshot } from '#server/utils/sttFiletrans'
import { getApiCallLogStats } from '#server/utils/apiCallLog'
import { getCloudServiceLogStats } from '#server/utils/cloudServiceLog'
import { getRateLimiterStats } from '#server/utils/rateLimiter'
import { validateSuccess } from '#server/utils/validate'
import { ensurePermission } from '#server/utils/permission'
import { PERMISSIONS } from '#shared/utils/permission'
import type { AdminMonitorSnapshot } from '#shared/types/adminMonitor'

/**
 * 运行监控聚合快照（取代原 GET /api/admin/queues）
 * GET /api/admin/monitor
 *
 * 五块进程内实时状态：云产品队列水位 / 评测闸门活跃数 / 上传任务分布 /
 * 埋点缓冲水位 / 限流滑窗。仅两条走索引的轻查询 + 内存读，无服务端缓存；
 * 单机内存态口径：多实例部署时快照仅反映本实例（见 AGENTS.md 单机条款）。
 */
export default defineEventHandler(
  async (event): Promise<ResPayload<AdminMonitorSnapshot | null>> => {
    const err = ensurePermission(event, PERMISSIONS.CONFIG)
    if (err) return err

    // 先同步并发配置到队列实例（冷启动未发生过云调用时队列还是初始 Infinity，
    // 直接读会误报「不限流」）；走 5min TTL 缓存，5s 轮询不放大查询
    const [evalGate, uploadTasks, stt] = await Promise.all([
      getEvalGateSnapshot(),
      fetchUploadTaskStats(),
      getSttMonitorSnapshot(),
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
      serverTime: new Date().toISOString(),
    })
  },
)
