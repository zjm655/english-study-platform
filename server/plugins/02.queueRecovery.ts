// server/plugins/02.queueRecovery.ts
// 启动期任务恢复：material_upload_record 是上传任务的唯一真相源，内存队列（serviceQueue）
// 重启即空。进程启动时把遗留的 queued/processing 记录统一标记为 failed，
// 用户/管理员可通过前端重新提交或管理端 reprocess 恢复（failed → processing 状态机闭环）。
//
// 注意：Nitro 的 runNitroPlugins 同步调用插件且不 await 返回的 Promise（实证于
// nitropack dist/runtime/internal/app.mjs），插件执行期间服务已可受理请求。
// 因此不能无条件 UPDATE——启动窗口期新建的 queued 记录会被误标 failed。
// 以插件初始化时刻为界（createdAt < startedAt），只恢复重启前遗留的任务；
// 插件本体保持同步签名，异步逻辑用内部 IIFE 承载（fire-and-forget，失败仅记日志）。
import { query } from '#server/utils/db'

export default defineNitroPlugin(() => {
  const startedAt = new Date()
  void (async () => {
    try {
      const result = (await query(
        `UPDATE material_upload_record
         SET status = 'failed', error_message = '服务重启中断，请重新提交或重处理'
         WHERE status IN ('queued', 'processing') AND createdAt < ?`,
        [startedAt],
      )) as unknown as { affectedRows?: number }
      const affected = result?.affectedRows ?? 0
      if (affected > 0) {
        logger.warn(`[queue recovery] 启动扫描：${affected} 条中断的上传任务已标记为失败`)
      }
    } catch (err) {
      // 启动扫描失败不阻塞服务启动（如迁移未执行时表不存在），仅记录
      logger.error('[queue recovery] 启动扫描失败:', err)
    }
  })()
})
