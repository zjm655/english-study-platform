/** 告警事件近 1 小时统计（P4-C2 迁移至运营统计：DB 查询 + 60s 缓存，独立于 monitor 快照） */
export interface AlertEventSummary {
  /** 近 1 小时各 source 计数（键为事件源，见 shared/utils/alertEvents ALERT_EVENT_SOURCES） */
  countsBySource: Record<string, number>
  /** 最近 5 条事件摘要（source/code/message/createdAt） */
  recent: Array<{
    id: number
    source: string
    level: string
    code: string | null
    message: string | null
    createdAt: string
  }>
}
