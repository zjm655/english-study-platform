// server/utils/guestIpGuard.ts
// 游客身份轮换的 IP 维度兜底（P3-C，内存态）：
// guest_key 可免费轮换（study-time 无 cookie 即签发），身份额度（键）可被换键清零——
// 本模块按 IP（及指纹）对游客高频操作设兜底上限，防脚本轮换滥用。
//
// 设计（P4-A1 修订）：
// - 计数键按用途分域（audio/eval/upload 前缀），互不挤占——P3 初版共用 ip:date 键，
//   导致评测上限 5 先触发会挤占音频上限 100（音频 6 次后即被拦），本次修复。
// - 内存 Map + 定时清理（保留当日），软上限防膨胀；重启清零与现有内存态一致。
// - 上限刻意宽松，防 NAT 用户误伤——兜的是「轮换攻击」，不是正常游客用量。
import { logger } from '#shared/utils/logger'

/** 单 IP 当日游客音频签名获取兜底上限（键额度 20 的 5 倍） */
export const IP_AUDIO_DAILY_CAP = 100
/** 单 IP 当日游客评测发放兜底上限（键额度 1/阶段×2=2 的 2.5 倍） */
export const IP_EVAL_DAILY_CAP = 5
/** 单 IP 当日游客录音上传兜底上限（P4-A1） */
export const IP_UPLOAD_DAILY_CAP = 50
/** 单指纹当日游客录音上传兜底上限（P4-A1，防单浏览器灌库） */
export const FP_UPLOAD_DAILY_CAP = 20
/** 单 IP 铸键频率（guest_token 免费签发，1 次/分） */
export const IP_KEY_ISSUE_INTERVAL_MS = 60_000

const MAX_ENTRIES = 50_000

/** 用途前缀 + ip:YYYY-MM-DD → 当日计数（P4-A1：分域键，互不挤占） */
const dailyMap = new Map<string, number>()
/** 指纹:YYYY-MM-DD → 当日上传计数（P4-A1） */
const fpUploadMap = new Map<string, number>()
/** ip → 最近一次铸键时间戳 */
const issueMap = new Map<string, number>()

/** 当前日期（Asia/Shanghai，与 guestOssLimit 同口径） */
function dateStr(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' })
}

function evictIfFull(map: Map<string, number>): void {
  if (map.size >= MAX_ENTRIES) {
    const oldest = map.keys().next().value
    if (oldest !== undefined) map.delete(oldest)
  }
}

/** 通用计数检查：未超上限则 +1 并放行 */
function checkAndCount(map: Map<string, number>, key: string, cap: number): boolean {
  const used = map.get(key) ?? 0
  if (used >= cap) return false
  evictIfFull(map)
  map.set(key, used + 1)
  return true
}

/** 单 IP 当日游客音频获取：计数 +1 并返回是否放行（超上限拒绝） */
export function checkGuestAudioByIp(ip: string): boolean {
  return checkAndCount(dailyMap, `audio:${ip}:${dateStr()}`, IP_AUDIO_DAILY_CAP)
}

/** 单 IP 当日游客评测发放：计数 +1 并返回是否放行（超上限拒绝） */
export function checkGuestEvalByIp(ip: string): boolean {
  return checkAndCount(dailyMap, `eval:${ip}:${dateStr()}`, IP_EVAL_DAILY_CAP)
}

/** 单 IP 当日游客录音上传：计数 +1 并返回是否放行（P4-A1） */
export function checkGuestUploadByIp(ip: string): boolean {
  return checkAndCount(dailyMap, `upload:${ip}:${dateStr()}`, IP_UPLOAD_DAILY_CAP)
}

/** 单指纹当日游客录音上传：计数 +1 并返回是否放行（P4-A1，防换指纹绕 IP 上限） */
export function checkGuestUploadByFp(fingerprint: string): boolean {
  return checkAndCount(fpUploadMap, `${fingerprint}:${dateStr()}`, FP_UPLOAD_DAILY_CAP)
}

/** 铸键频率：同一 IP 1 次/分钟（guest_token 免费签发防轮换的供给侧限制） */
export function checkGuestKeyIssue(ip: string): boolean {
  const now = Date.now()
  const last = issueMap.get(ip)
  if (last !== undefined && now - last < IP_KEY_ISSUE_INTERVAL_MS) return false
  issueMap.set(ip, now)
  if (issueMap.size > MAX_ENTRIES) issueMap.clear()
  return true
}

/** 只读探针（供运行监控观测，不暴露 Map 引用） */
export function getGuestIpGuardStats(): {
  dailyEntries: number
  fpEntries: number
  issueEntries: number
} {
  return { dailyEntries: dailyMap.size, fpEntries: fpUploadMap.size, issueEntries: issueMap.size }
}

// 定时清理：过期条目按日期兜底（保留当日），防内存无界
if (typeof setInterval !== 'undefined') {
  setInterval(
    () => {
      try {
        const today = dateStr()
        for (const [key] of dailyMap) {
          if (!key.endsWith(`:${today}`)) dailyMap.delete(key)
        }
        for (const [key] of fpUploadMap) {
          if (!key.endsWith(`:${today}`)) fpUploadMap.delete(key)
        }
      } catch (err) {
        logger.error('[guest ip guard] 定时清理失败:', err)
      }
    },
    60 * 60 * 1000,
  ) // 每小时清理一次非当日条目
}
