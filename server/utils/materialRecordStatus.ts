// server/utils/materialRecordStatus.ts
// 材料上传任务状态批量查询（轮询轻接口共用）：
// - 一次 IN 查询拿回多条记录状态（用户端强制 user_id 过滤防 IDOR）；
// - queuedAhead 用一次全局 queued 快照在 JS 内算完（快照行数受 MAX_QUEUED 约束，
//   消除 records/index.get.ts 时代的每条一次 COUNT 的 N+1 查询）。
import { query } from './db'
import type { MaterialRecordStatusItem, MaterialUploadStatus } from '#shared/types/material'

interface StatusRow {
  id: number
  status: string
  error_message: string | null
  segment_id: number | null
  title: string
}

/** 全局 queued 快照：返回按 id 升序的排队记录 id 列表（行数 ≤ MAX_QUEUED） */
export async function fetchQueuedSnapshot(): Promise<number[]> {
  const rows = await query<{ id: number }>(
    `SELECT id FROM material_upload_record WHERE status = 'queued' ORDER BY id`,
  )
  return rows.map((r) => r.id)
}

/** 基于快照为 queued 项计算前方排队数（与既有「id 更小即在前」估算口径一致） */
export function countAheadInSnapshot(snapshot: number[], id: number): number {
  let ahead = 0
  for (const qid of snapshot) {
    if (qid < id) ahead++
    else break
  }
  return ahead
}

/**
 * 批量查询上传记录状态。
 * @param ids 记录 id 列表（调用方经 zod 保证为去重正整数、数量 ≤50）
 * @param userId 传入时仅返回该用户自己的记录（用户端必传；管理端省略查所有）
 */
export async function fetchRecordStatuses(
  ids: number[],
  userId?: number,
): Promise<MaterialRecordStatusItem[]> {
  if (!ids.length) return []

  const placeholders = ids.map(() => '?').join(',')
  const params: Array<number> = [...ids]
  let where = `id IN (${placeholders})`
  if (userId !== undefined) {
    where += ' AND user_id = ?'
    params.push(userId)
  }

  const rows = await query<StatusRow>(
    `SELECT id, status, error_message, segment_id, title FROM material_upload_record WHERE ${where}`,
    params,
  )

  const items: MaterialRecordStatusItem[] = rows.map((r) => ({
    id: r.id,
    status: r.status as MaterialUploadStatus,
    error_message: r.error_message,
    segment_id: r.segment_id,
    title: r.title,
  }))

  // 仅存在排队项时才拉快照（活跃期一次轻查询，无排队时零额外开销）
  if (items.some((i) => i.status === 'queued')) {
    const snapshot = await fetchQueuedSnapshot()
    for (const item of items) {
      if (item.status === 'queued') {
        item.queuedAhead = countAheadInSnapshot(snapshot, item.id)
      }
    }
  }

  return items
}
