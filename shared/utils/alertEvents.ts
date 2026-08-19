// shared/utils/alertEvents.ts
// 告警事件源枚举（单一真相源，P4-D2）：
// alert_event.source 的取值白名单——类型（alertEventLog.ts）、端点校验（events.get.ts z.enum）、
// 前端标签（events.vue SOURCE_LABELS）、类型定义（adminLogs.d.ts）全部从本常量推导，
// 新增事件源只需改此处 + 迁移 037 表注释（SQL 无法引用代码，注释注明同步约定）。

/** 告警事件源白名单（与 alert_event 表 source 列语义一致） */
export const ALERT_EVENT_SOURCES = [
  'client_error',
  'log_queue',
  'task_fail',
  'cloud_health',
  'security',
  'redis_health',
] as const

/** 告警事件源类型 */
export type AlertEventSource = (typeof ALERT_EVENT_SOURCES)[number]
