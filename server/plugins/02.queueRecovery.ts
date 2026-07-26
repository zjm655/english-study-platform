// server/plugins/02.queueRecovery.ts
// 启动期任务恢复：material_upload_record 是上传任务的唯一真相源，内存队列（serviceQueue）
// 重启即空。进程启动时把遗留的 queued/processing 记录统一标记为 failed，
// 用户/管理员可通过前端重新提交或管理端 reprocess 恢复（failed → processing 状态机闭环）。
//
// 单实例部署下启动时刻不可能存在真正执行中的任务，无条件 UPDATE 简单且正确；
// dev HMR / 重启会误伤在途任务，属可接受代价（failed 可重处理，error_message 明示原因）。
// 注意：必须 await——Nitro 启动期等待异步插件完成后才受理请求，
// 若 fire-and-forget 会与新请求的 queued 记录写入并行，存在误标新任务为 failed 的竞态窗口。
import { query } from '#server/utils/db'

export default defineNitroPlugin(async () => {
  try {
    const result = (await query(
      `UPDATE material_upload_record
       SET status = 'failed', error_message = '服务重启中断，请重新提交或重处理'
       WHERE status IN ('queued', 'processing')`,
    )) as unknown as { affectedRows?: number }
    const affected = result?.affectedRows ?? 0
    if (affected > 0) {
      logger.warn(`[queue recovery] 启动扫描：${affected} 条中断的上传任务已标记为失败`)
    }
  } catch (err) {
    // 启动扫描失败不阻塞服务启动（如迁移未执行时表不存在），仅记录
    logger.error('[queue recovery] 启动扫描失败:', err)
  }
})
