/** 云产品并发队列水位（serviceQueue getQueueStats 输出） */
export interface QueueStatItem {
  name: 'tts' | 'nls' | 'deepseek' | 'upload'
  /** 并发上限（0=不限流直通） */
  concurrency: number
  /** 排队中任务数 */
  size: number
  /** 执行中任务数 */
  pending: number
}

/** 评测闸门快照 */
export interface EvalGateSnapshot {
  /** 近窗口已发放的评测鉴权数（活跃估算） */
  active: number
  /** 闸门上限（0=未启用） */
  limit: number
  /** 估算窗口秒数 */
  windowSec: number
}

/** 上传任务状态分布 */
export interface UploadTaskStats {
  queued: number
  processing: number
  /** 今日（服务器时区）成功数 */
  todaySuccess: number
  /** 今日（服务器时区）失败数 */
  todayFailed: number
}

/** 埋点内存缓冲水位（数组形态：新增缓冲探针不改类型形状） */
export interface LogBufferStat {
  name: string
  /** 当前缓冲条数 */
  size: number
  /** 软上限（超出丢弃最旧） */
  maxSize: number
  /** 累计丢弃条数 */
  dropped: number
}

/** 限流滑窗水位 */
export interface RateLimiterStats {
  /** 活跃限流桶数（键为 ip:path 组合，非在线 IP 数） */
  trackedKeys: number
  maxEntries: number
}

/** GET /api/admin/monitor 聚合快照（均为进程内实时状态，多实例部署仅反映本实例） */
export interface AdminMonitorSnapshot {
  queues: QueueStatItem[]
  evalGate: EvalGateSnapshot
  uploadTasks: UploadTaskStats
  buffers: LogBufferStat[]
  rateLimiter: RateLimiterStats
  /** 快照生成时刻（ISO 字符串，服务器时间） */
  serverTime: string
}
