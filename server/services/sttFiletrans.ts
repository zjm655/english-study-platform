// server/services/sttFiletrans.ts
// STT 双后端调度：标准版录音文件识别（filetrans，免费试用每日 2h）优先 + 极速版（flash）自动回退。
//
// 设计要点：
// - speechToText.ts（flash 实现）零改动，本文件是其上层调度：读 sys_config.stt_backend 分流，
//   filetrans 命中回退集（额度尽/试用到期/并发超限/下载失败/轮询超时）时本次调用改走 flash，不写回配置。
// - filetrans 是 POP RPC API（AK 签名，不需要 CreateToken）：SubmitTask 提交 + GetTaskResult 轮询。
//   仅 SubmitTask 包 withQueue('nls')（毫秒级，提交并发≈阿里侧任务并发语义）；轮询在队列外裸跑——
//   整段包裹会占并发 2 的槽 10 分钟，恰好饿死回退所需的 flash 调用。
// - 无额度查询 API：今日已用时长本地口径（cloud_service_call_log.biz_duration_ms 按天 SUM），
//   回退次数用独立埋点行（operation='sttFallback'）按天 COUNT——重启安全，自然日口径不丢数。
import RPCClient from '@alicloud/pop-core'
import { speechToText, type SpeechToTextResult } from './speechToText'
import { signUrl } from '#server/utils/oss'
import { withQueue } from './serviceQueue'
import { logCloudServiceCall } from '#server/utils/cloudServiceLog'
import { fileLog, fileLogError } from '#server/utils/fileLogger'
import { getSysConfigKeys } from '#server/utils/configStore'
import { deriveNlsQuotaInfo, NLS_DAILY_FREE_QUOTA_MIN } from '#server/utils/nlsQuota'
import type { NlsQuotaInfo } from '#shared/types/nlsQuota'

// ==================== 常量 ====================

const FILETRANS_ENDPOINT = 'https://filetrans.cn-shanghai.aliyuncs.com'
const FILETRANS_API_VERSION = '2018-08-17'

/** 签名 URL 有效期（秒）：覆盖阿里侧排队 + 轮询上限 + 余量 */
const FILE_LINK_EXPIRE = 3600
/** 轮询起始间隔（毫秒） */
const POLL_BASE_MS = 5000
/** 轮询衰减倍率 */
const POLL_FACTOR = 1.5
/** 轮询间隔上限（毫秒） */
const POLL_MAX_MS = 30_000
/** 轮询总超时（毫秒），超时回退 flash */
const POLL_TIMEOUT_MS = 10 * 60_000

/** 标准版每日免费额度（分钟），监控展示口径（单一真相源在 #server/utils/nlsQuota） */
export const FILETRANS_DAILY_QUOTA_MIN = NLS_DAILY_FREE_QUOTA_MIN
/** 免费试用期（天） */
const TRIAL_DAYS = 90

/** filetrans 状态码 */
const STATUS_SUCCESS = 21050000
const STATUS_RUNNING = 21050001
const STATUS_QUEUEING = 21050002
const STATUS_NO_VALID_FRAGMENT = 21050003

/**
 * 回退集：这些错误 flash（用 buffer 不依赖 URL/额度）有机会救活——
 * 41050001 单日额度尽 / 40000010 试用到期或欠费 / 40000005 并发超限 / 41050002 文件下载失败
 * （含 signUrl 降级返回裸 URL 后私有桶 403 的场景）。
 * 其他错误（如 41050003 格式错误）不回退：坏文件回退也救不了，白烧极速版费用。
 */
const FALLBACK_CODES = new Set([41050001, 40000010, 40000005, 41050002])

// ==================== 内部类型 ====================

interface FiletransSentence {
  Text: string
}

interface FiletransTaskResponse {
  TaskId?: string
  StatusCode?: number
  StatusText?: string
  BizDuration?: number
  Result?: {
    Sentences?: FiletransSentence[]
  }
}

interface FileTransResult extends SpeechToTextResult {
  /** 音频业务时长（毫秒），来自 BizDuration */
  bizDurationMs?: number
  /** 命中回退集（错误码/超时），调度层应改走 flash */
  fallbackEligible?: boolean
}

// ==================== POP 客户端（仿 bss.ts 懒加载单例） ====================

let cachedClient: RPCClient | null = null

function getClient(): RPCClient | null {
  if (cachedClient) return cachedClient
  const nls = useRuntimeConfig().nls as { accessKeyId?: string; accessKeySecret?: string }
  if (!nls?.accessKeyId || !nls?.accessKeySecret) return null
  cachedClient = new RPCClient({
    endpoint: FILETRANS_ENDPOINT,
    apiVersion: FILETRANS_API_VERSION,
    accessKeyId: nls.accessKeyId,
    accessKeySecret: nls.accessKeySecret,
  })
  return cachedClient
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** 从 pop-core 错误对象/响应中提取 filetrans 数字状态码（无则 null） */
function extractStatusCode(err: unknown): number | null {
  const e = err as { code?: number | string; data?: { StatusCode?: number } }
  if (typeof e?.data?.StatusCode === 'number') return e.data.StatusCode
  const raw = e?.code
  const n = typeof raw === 'number' ? raw : parseInt(String(raw ?? ''), 10)
  return Number.isInteger(n) ? n : null
}

// ==================== filetrans 识别（SubmitTask + 轮询） ====================

/**
 * 标准版录音文件识别：提交任务 + 轮询结果。
 * 永不抛出；fallbackEligible=true 表示命中回退集，调度层应改走 flash。
 */
export async function fileTransRecognize(fileLink: string): Promise<FileTransResult> {
  const client = getClient()
  const nls = useRuntimeConfig().nls as { appKey?: string }
  if (!client || !nls?.appKey) {
    // 配置缺失按可回退处理：flash 有独立的配置校验
    return { success: false, error: 'filetrans 配置缺失', fallbackEligible: true }
  }

  // 1. SubmitTask（仅此调用占 nls 并发名额；计时起点在队列 acquire 后）
  let taskId: string
  let callStart = 0
  try {
    const resp = (await withQueue('nls', () => {
      callStart = Date.now()
      return client.request(
        'SubmitTask',
        {
          Task: JSON.stringify({
            appkey: nls.appKey,
            file_link: fileLink,
            version: '4.0',
            enable_sample_rate_adaptive: true,
          }),
        },
        { method: 'POST' },
      )
    })) as FiletransTaskResponse
    if (resp.StatusCode !== STATUS_SUCCESS || !resp.TaskId) {
      const code = resp.StatusCode ?? -1
      const msg = `SubmitTask 失败: ${resp.StatusText ?? '未知'} (${code})`
      void logCloudServiceCall({
        service: 'nls',
        operation: 'filetrans',
        success: false,
        durationMs: Date.now() - callStart,
        errorMessage: msg.substring(0, 500),
      })
      fileLogError('nls', '[filetrans] SubmitTask 失败', msg)
      return { success: false, error: msg, fallbackEligible: FALLBACK_CODES.has(code) }
    }
    taskId = resp.TaskId
  } catch (err) {
    const e = err as { code?: string; message?: string }
    const code = extractStatusCode(err)
    const msg = (e?.code ? `${e.code}: ${e.message ?? ''}` : String(err)).substring(0, 500)
    void logCloudServiceCall({
      service: 'nls',
      operation: 'filetrans',
      success: false,
      durationMs: callStart ? Date.now() - callStart : 0,
      errorMessage: msg,
    })
    fileLogError('nls', '[filetrans] SubmitTask 异常', msg)
    return {
      success: false,
      error: `SubmitTask 异常: ${msg}`,
      fallbackEligible: code !== null && FALLBACK_CODES.has(code),
    }
  }

  logger.info(`[filetrans] 任务已提交 taskId=${taskId}`)

  // 2. 轮询 GetTaskResult（队列外裸跑：轻 GET，QPS 500 富余；间隔指数衰减）
  const pollStart = Date.now()
  let interval = POLL_BASE_MS
  while (Date.now() - pollStart < POLL_TIMEOUT_MS) {
    await sleep(interval)
    interval = Math.min(interval * POLL_FACTOR, POLL_MAX_MS)

    let data: FiletransTaskResponse
    try {
      data = (await client.request('GetTaskResult', { TaskId: taskId })) as FiletransTaskResponse
    } catch (err) {
      // 单次轮询网络抖动不终止任务，等下一轮（总超时兜底）
      logger.warn('[filetrans] GetTaskResult 异常，继续轮询:', err)
      continue
    }

    const code = data.StatusCode ?? -1
    if (code === STATUS_RUNNING || code === STATUS_QUEUEING) continue

    const durationMs = Date.now() - pollStart
    if (code === STATUS_SUCCESS || code === STATUS_NO_VALID_FRAGMENT) {
      // 21050003：VAD 未检测到有效语音，视为成功空文本（materialJob 对空文本有跳过审核的容错）
      const sentences = data.Result?.Sentences ?? []
      const text = sentences.map((s) => s.Text).join('')
      const bizDurationMs = data.BizDuration
      void logCloudServiceCall({
        service: 'nls',
        operation: 'filetrans',
        success: true,
        durationMs,
        bizDurationMs: bizDurationMs ?? null,
      })
      logger.info(`[filetrans] 识别成功 (${text.length}字, BizDuration=${bizDurationMs ?? '-'}ms)`)
      fileLog('nls', 'info', '[filetrans] 识别成功', {
        taskId,
        textLength: text.length,
        bizDurationMs,
      })
      return { success: true, text, ...(bizDurationMs !== undefined ? { bizDurationMs } : {}) }
    }

    // 终态失败
    const msg = `识别失败: ${data.StatusText ?? '未知'} (${code})`
    void logCloudServiceCall({
      service: 'nls',
      operation: 'filetrans',
      success: false,
      durationMs,
      errorMessage: msg.substring(0, 500),
    })
    fileLogError('nls', '[filetrans] 识别失败', msg, { taskId })
    return { success: false, error: msg, fallbackEligible: FALLBACK_CODES.has(code) }
  }

  // 3. 轮询超时：回退集成员
  const timeoutMsg = `轮询超时（${POLL_TIMEOUT_MS / 60000} 分钟）taskId=${taskId}`
  void logCloudServiceCall({
    service: 'nls',
    operation: 'filetrans',
    success: false,
    durationMs: Date.now() - pollStart,
    errorMessage: timeoutMsg,
  })
  fileLogError('nls', '[filetrans] 轮询超时', timeoutMsg)
  return { success: false, error: timeoutMsg, fallbackEligible: true }
}

// ==================== 调度入口（materialJob 使用） ====================

/** 最近一次实际使用的后端（进程内观测值，供监控页对照配置值诊断） */
let lastUsedBackend: 'filetrans' | 'flash' | null = null

/**
 * 读 stt_backend 配置（任务路径）：经 configStore（Redis 10s / 内存降级 5min）。
 * 缺键/异常保守回 flash——语义与直读 DB 时逐字一致（仅 'filetrans' 才走标准版）。
 */
async function getSttBackend(): Promise<'filetrans' | 'flash'> {
  try {
    const map = await getSysConfigKeys(['stt_backend'])
    return map.get('stt_backend') === 'filetrans' ? 'filetrans' : 'flash'
  } catch {
    return 'flash'
  }
}

export interface RecognizeSpeechParams {
  audioBuffer: Buffer
  format?: 'mp3' | 'wav' | 'aac' | 'opus' | 'mp4'
  /** 音频已上传的 OSS key（filetrans 后端必需；缺失时直接走 flash） */
  ossKey?: string
}

/**
 * STT 统一入口：按 stt_backend 分流，filetrans 命中回退集时本次调用自动回退 flash。
 * 永不抛出。
 */
export async function recognizeSpeech(params: RecognizeSpeechParams): Promise<SpeechToTextResult> {
  const { audioBuffer, format = 'mp3', ossKey } = params
  const backend = await getSttBackend()

  if (backend === 'flash' || !ossKey) {
    lastUsedBackend = 'flash'
    return speechToText(audioBuffer, format)
  }

  // filetrans 路径：签名 URL（公网；bucket 与 filetrans 不同地域，内网不可达）
  const fileLink = await signUrl(ossKey, FILE_LINK_EXPIRE)
  const result = await fileTransRecognize(fileLink)

  if (result.success) {
    lastUsedBackend = 'filetrans'
    return { success: true, text: result.text, duration: result.bizDurationMs }
  }

  if (result.fallbackEligible) {
    // 记独立回退埋点行（监控页按天 COUNT），然后本次改走 flash——不写回配置，次日额度恢复自然回到标准版
    void logCloudServiceCall({
      service: 'nls',
      operation: 'sttFallback',
      success: true,
      durationMs: 0,
      errorMessage: (result.error ?? '未知原因').substring(0, 500),
    })
    logger.warn(`[stt] filetrans 回退 flash: ${result.error}`)
    fileLog('nls', 'warn', '[stt] filetrans 回退 flash', { reason: result.error })
    lastUsedBackend = 'flash'
    return speechToText(audioBuffer, format)
  }

  lastUsedBackend = 'filetrans'
  return { success: false, error: result.error }
}

// ==================== 监控快照（供 GET /api/admin/monitor） ====================

export interface SttMonitorSnapshot {
  /** 配置的后端 */
  backend: 'filetrans' | 'flash'
  /** 最近一次实际使用的后端（进程内观测，重启为 null） */
  lastUsedBackend: 'filetrans' | 'flash' | null
  /** 今日标准版已识别音频时长（毫秒，本地聚合口径） */
  todayBizMs: number
  /** 每日免费额度（分钟） */
  freeQuotaMin: number
  /** 试用开通日期（YYYY-MM-DD，未设置为 null） */
  trialStartDate: string | null
  /** 试用剩余天数（未设置为 null，可为负） */
  trialDaysLeft: number | null
  /** 今日自动回退次数 */
  todayFallbacks: number
}

/** STT 监控快照：今日用量/回退数走 idx_service_created 当日范围，配置为主键级查询 */
export async function getSttMonitorSnapshot(): Promise<SttMonitorSnapshot> {
  const { query } = await import('#server/utils/db')

  const [usedRows, fallbackRows, configRows] = await Promise.all([
    query<{ total: number | string | null }>(
      `SELECT COALESCE(SUM(biz_duration_ms), 0) AS total FROM cloud_service_call_log
       WHERE service = 'nls' AND operation = 'filetrans' AND success = 1 AND createdAt >= CURDATE()`,
    ),
    query<{ cnt: number | string }>(
      `SELECT COUNT(*) AS cnt FROM cloud_service_call_log
       WHERE service = 'nls' AND operation = 'sttFallback' AND createdAt >= CURDATE()`,
    ),
    // admin 展示路径：按 D-P1-4 直查库展示真相，不走 configStore（监控对照真实配置而非缓存）
    query<{ config_key: string; config_value: string }>(
      `SELECT config_key, config_value FROM sys_config WHERE config_key IN ('stt_backend', 'stt_trial_start_date')`,
    ),
  ])

  const map = new Map(configRows.map((r) => [r.config_key, r.config_value]))
  const backend = map.get('stt_backend') === 'filetrans' ? 'filetrans' : 'flash'
  const rawDate = map.get('stt_trial_start_date') ?? '-'
  const isDate = /^\d{4}-\d{2}-\d{2}$/.test(rawDate)
  let trialDaysLeft: number | null = null
  if (isDate) {
    const start = new Date(`${rawDate}T00:00:00`)
    const expireAt = start.getTime() + TRIAL_DAYS * 86_400_000
    trialDaysLeft = Math.floor((expireAt - Date.now()) / 86_400_000)
  }

  return {
    backend,
    lastUsedBackend,
    todayBizMs: Number(usedRows[0]?.total ?? 0),
    freeQuotaMin: FILETRANS_DAILY_QUOTA_MIN,
    trialStartDate: isDate ? rawDate : null,
    trialDaysLeft,
    todayFallbacks: Number(fallbackRows[0]?.cnt ?? 0),
  }
}

// ==================== 免费额度查询（管理员上传页展示） ====================

/**
 * 今日 NLS 免费额度信息（管理员上传页展示与超阈值提示）。
 * 复用 getSttMonitorSnapshot 同款口径：filetrans 成功调用按 biz_duration_ms 当日 SUM。
 * 查询异常按 0 已用返回（旁路读取不阻断上传业务）。
 */
export async function getNlsQuotaInfo(): Promise<NlsQuotaInfo> {
  const { query } = await import('#server/utils/db')

  let usedMs = 0
  let backend: 'filetrans' | 'flash' = 'flash'
  try {
    const [usedRows, configRows] = await Promise.all([
      query<{ total: number | string | null }>(
        `SELECT COALESCE(SUM(biz_duration_ms), 0) AS total FROM cloud_service_call_log
         WHERE service = 'nls' AND operation = 'filetrans' AND success = 1 AND createdAt >= CURDATE()`,
      ),
      // admin 展示路径：按 D-P1-4 直查库展示真相，不走 configStore（上传页对照真实配置而非缓存）
      query<{ config_value: string }>(
        `SELECT config_value FROM sys_config WHERE config_key = 'stt_backend'`,
      ),
    ])
    usedMs = Number(usedRows[0]?.total ?? 0) || 0
    backend = configRows[0]?.config_value === 'filetrans' ? 'filetrans' : 'flash'
  } catch {
    // 查询失败按 0 已用 + 默认后端返回，不阻断上传业务
  }

  return deriveNlsQuotaInfo({ usedMs, backend })
}
