// server/services/materialReprocess.ts
// 重处理失败上传记录的核心逻辑（单条端点与批量端点共用）：
// 原子锁 failed→queued 防重入 → 查记录详情 → fire-and-forget 入 upload 队列 → 排队被拒兜底回写 failed。
// 容量检查（isUploadQueueFull / 剩余容量截断）由调用方在入队前自行完成，本模块只负责状态机与入队。
import type { ResultSetHeader } from 'mysql2'
import { query } from '#server/utils/db'
import { processAdminMaterial } from './adminUpload'
import { updateRecordFailed } from './materialJob'

export interface ReprocessResult {
  ok: boolean
  /** ok=false 时的原因（记录不存在 / 仅失败记录可重处理等） */
  reason?: string
  /** 对应单条端点的 HTTP 语义（404 记录不存在 / 400 状态不对），批量端点忽略 */
  code?: number
}

/**
 * 重处理一条失败的上传记录。
 * 防重入：先将 status 从 failed 原子更新为 queued，利用状态机避免并发重复触发；
 * 排队期间保持 queued（正确计入队列深度/排队位置口径），由 processAdminMaterial 执行时置 processing。
 */
export async function reprocessRecord(id: number, unitId: number): Promise<ReprocessResult> {
  // 原子状态转换：failed → queued（affectedRows=0 说明已被抢占或状态不对）
  const lockResult = await query<ResultSetHeader>(
    'UPDATE material_upload_record SET status = ?, error_message = NULL WHERE id = ? AND status = ?',
    ['queued', id, 'failed'],
  )
  const affected = (lockResult as unknown as ResultSetHeader).affectedRows ?? 0
  if (affected === 0) {
    // 可能记录不存在，也可能已不是 failed 状态
    const rows = await query<{ status: string }>(
      'SELECT status FROM material_upload_record WHERE id = ?',
      [id],
    )
    if (!rows.length) return { ok: false, reason: '记录不存在', code: 404 }
    return { ok: false, reason: '仅失败记录可重处理，当前状态：' + rows[0]!.status, code: 400 }
  }

  // 获取记录完整信息（含 nls_check：重处理沿用原开关，标记不丢失）
  const rows = await query<{
    user_id: number
    title: string
    text_content: string
    voice: string
    is_public: number
    nls_check: number
  }>(
    'SELECT user_id, title, text_content, voice, is_public, nls_check FROM material_upload_record WHERE id = ?',
    [id],
  )
  const record = rows[0]!
  const config = useRuntimeConfig()

  // fire-and-forget：入 upload 队列异步处理（管理员低优先级），失败时 processAdminMaterial 内部会将 status 改回 failed
  const { withQueue } = await import('#server/services/serviceQueue')
  withQueue(
    'upload',
    () =>
      processAdminMaterial({
        userId: record.user_id,
        unitId,
        textContent: record.text_content,
        title: record.title,
        voice: record.voice,
        isPublic: record.is_public,
        nlsCheck: record.nls_check === 1,
        bucket: config.oss.bucket || '',
        existingRecordId: id,
      }),
    { priority: 0 },
  ).catch(async (err) => {
    // 兜底：任务在排队阶段被拒时回写 failed，避免记录永久卡在 queued/processing
    logger.error('[material reprocess] 重处理异常:', err)
    await updateRecordFailed(id, '任务调度异常，请重试').catch(() => {})
  })

  return { ok: true }
}
