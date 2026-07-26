import { query } from '#server/utils/db'
import { validateError, validateSuccess } from '#server/utils/validate'
import { fetchQueuedSnapshot, countAheadInSnapshot } from '#server/utils/materialRecordStatus'
import type { MaterialUploadRecordRow } from '#server/types/db'
import type { MaterialUploadRecordListItem, MaterialUploadStatus } from '#shared/types/material'

/**
 * 查询当前用户的材料上传记录
 * GET /api/material/records?limit=20&offset=0
 */
export default defineEventHandler(
  async (event): Promise<ResPayload<MaterialUploadRecordListItem[]>> => {
    const user = event.context.user
    if (!user) return validateError('未登录', 401)

    const q = getQuery(event)
    const limit = Math.min(Number(q.limit) || 20, 100)
    const offset = Math.max(Number(q.offset) || 0, 0)

    const rows = await query<MaterialUploadRecordRow>(
      `SELECT id, title, status, error_message, segment_id, is_public, createdAt
     FROM material_upload_record
     WHERE user_id = ?
     ORDER BY createdAt DESC
     LIMIT ? OFFSET ?`,
      [user.id, limit, offset],
    )

    const list: MaterialUploadRecordListItem[] = rows.map((r) => ({
      id: r.id,
      title: r.title,
      status: r.status as MaterialUploadStatus,
      error_message: r.error_message,
      segment_id: r.segment_id,
      is_public: r.is_public,
      createdAt: r.createdAt,
    }))

    // 排队中的记录附加前方任务数（一次全局 queued 快照 JS 内算完，避免每条一次 COUNT 的 N+1）
    const queuedItems = list.filter((r) => r.status === 'queued')
    if (queuedItems.length > 0) {
      const snapshot = await fetchQueuedSnapshot()
      for (const item of queuedItems) {
        item.queuedAhead = countAheadInSnapshot(snapshot, item.id)
      }
    }

    return validateSuccess(list)
  },
)
