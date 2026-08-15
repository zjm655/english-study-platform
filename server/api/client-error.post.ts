/**
 * POST /api/client-error
 *
 * 前端错误上报（P1-E）：浏览器 JS 错误 / 未捕获 Promise 拒绝经 logger.error 钩子节流上报，
 * 落 alert_event 表（source=client_error，未来告警通道数据源）。
 *
 * 防滥用三层：
 * 1. IP 限流（rateLimiter 全局 IP 级自动覆盖本路径）；
 * 2. sys_config.client_error_report_enabled 总开关（默认开，管理端可关）；
 * 3. 写入走内存队列（alertEventLog，批量 + 静默吞错），不阻塞响应。
 *
 * 公开端点：错误常发生在登录前，不要求鉴权；body 仅 message/stack/url，无敏感字段约定。
 */
import { query } from '#server/utils/db'
import { logAlertEvent } from '#server/utils/alertEventLog'
import { clientErrorReportSchema } from '#shared/schemas/clientError'
import { validateSuccess, validateError } from '#server/utils/validate'

export default defineEventHandler(async (event): Promise<ResPayload<null>> => {
  // 总开关（sys_config，查库失败按默认开启处理——旁路能力不阻塞上报）
  try {
    const rows = await query<{ config_value: string }>(
      `SELECT config_value FROM sys_config WHERE config_key = 'client_error_report_enabled'`,
    )
    if (rows[0]?.config_value === '0') {
      return validateSuccess(null, 'ok') // 已关闭：静默接受，不产生事件
    }
  } catch {
    // 查库失败不阻断（旁路）
  }

  const parsed = clientErrorReportSchema.safeParse(await readBody(event).catch(() => ({})))
  if (!parsed.success) {
    return validateError(parsed.error.issues[0]?.message ?? '参数校验失败', 400)
  }
  const { message, stack, url } = parsed.data

  void logAlertEvent({
    source: 'client_error',
    level: 'error',
    code: 'client_js_error',
    message,
    context: stack || url ? { stack: stack ?? undefined, url: url ?? undefined } : null,
  })

  return validateSuccess(null, 'ok')
})
