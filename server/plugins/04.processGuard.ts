// server/plugins/04.processGuard.ts
// 全局异常兜底：unhandledRejection / uncaughtException 同步文件留痕 + 控制台日志。
//
// 背景：代码大量使用 fire-and-forget（埋点/清理/队列），偶发的未捕获异步异常在 Node 默认
// 语义下会崩进程，pm2 静默重启且无任何档案；本插件保证「崩溃必有痕」
// （logs/error/{date}.log 同步写，进程退出前来得及落盘）。
//
// 语义选择：保留 Node 默认崩溃语义（记录后 process.exit(1)，而非吞掉继续运行）——
// 状态已损坏的进程（埋点队列/限流滑窗等内存态不一致）继续服务会放大故障；
// 单实例 pm2 会自动拉起，queueRecovery 对中断任务有 startedAt 边界兜底。
import { fileLogErrorSync } from '#server/utils/fileLogger'

export default defineNitroPlugin(() => {
  const record = (type: 'unhandledRejection' | 'uncaughtException', reason: unknown): void => {
    const message = reason instanceof Error ? reason.message : String(reason)
    const stack = reason instanceof Error ? (reason.stack ?? null) : null
    fileLogErrorSync('error', `[processGuard:${type}] ${message}`, stack ?? '')
    logger.error(`[processGuard:${type}]`, reason)
  }

  process.on('unhandledRejection', (reason) => {
    record('unhandledRejection', reason)
    process.exit(1)
  })

  process.on('uncaughtException', (err) => {
    record('uncaughtException', err)
    process.exit(1)
  })
})
