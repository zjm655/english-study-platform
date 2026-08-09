// server/utils/ossPlaybackLog.ts
// OSS 前端播放埋点写入：把「经签名 URL 直连 OSS 的外网播放」次数累计到有界日汇总表 oss_playback_daily。
//
// 为何需要：浏览器经签名 URL 直连 OSS 播放会产生外网下行流量（OSS 唯一实际计费项：
// 上传流入内外网免费、内网流出免费、仅外网流出收费），但该请求绕过本服务，
// api_call_log / cloud_service_call_log 均无从记录。前端 fire-and-forget 上报到
// /api/oss/playback，本模块累加计数并批量 UPSERT 落库。
//
// 与 cloudServiceLog 同构（内存缓冲 + 定时 flush + 阈值立即 flush + close 前 flush），
// 但因只需「按天计数」，用整型累加器替代条目数组，天然有界、零丢弃风险。
// 写埋点失败【静默吞错】——埋点是旁路能力，绝不阻塞业务流程。
import { query } from './db'
import { logger } from '#shared/utils/logger'

const FLUSH_INTERVAL_MS = 5000
/** 累计到该阈值立即 flush，缩小高频播放场景的丢失窗口 */
const FLUSH_THRESHOLD = 50

/** 待落库的播放计数（尚未写入 DB） */
let pendingCount = 0
let timer: ReturnType<typeof setInterval> | null = null

function ensureTimer(): void {
  if (timer !== null) return
  timer = setInterval(flush, FLUSH_INTERVAL_MS)
  if (timer && typeof timer === 'object' && 'unref' in timer) {
    timer.unref() // 不阻止进程退出
  }
}

async function flush(): Promise<void> {
  if (pendingCount === 0) return
  // 先取走当前累计再写库；失败则回补，避免并发下丢计数
  const batch = pendingCount
  pendingCount = 0
  try {
    await query(
      `INSERT INTO oss_playback_daily (stat_date, play_count)
       VALUES (CURDATE(), ?)
       ON DUPLICATE KEY UPDATE play_count = play_count + VALUES(play_count)`,
      [batch],
    )
  } catch (err) {
    // 写入失败：回补计数，等待下次 flush 重试（埋点为旁路，不重试也可容忍丢弃）
    pendingCount += batch
    logger.error('[oss playback log] 批量写入失败:', err)
  }
}

/**
 * 记录一次 OSS 外网播放（累加计数，不阻塞）。
 * 调用方以 fire-and-forget 方式调用：recordOssPlayback()
 */
export function recordOssPlayback(): void {
  pendingCount++
  ensureTimer()
  if (pendingCount >= FLUSH_THRESHOLD) {
    void flush()
  }
}

/**
 * 进程退出前把累计计数写完（供 Nitro close 钩子调用）。
 * flush 内失败会回补计数，但退出场景不再重试，尽力而为。
 */
export async function flushOssPlaybackLog(): Promise<void> {
  await flush()
}
