// server/utils/guestIpGuard.ts
// 游客身份轮换的 IP 维度兜底（P3-C）：
// guest_key 可免费轮换（study-time 无 cookie 即签发），身份额度（键）可被换键清零——
// 本模块按 IP（及指纹）对游客高频操作设兜底上限，防脚本轮换滥用。
//
// 设计（P4-A1 修订 + P2 计数外置）：
// - 计数键按用途分域（guest-audio/guest-eval/guest-upload/guest-fp 前缀），互不挤占——
//   P3 初版共用 ip:date 键，导致评测上限 5 先触发会挤占音频上限 100（音频 6 次后即被拦），已修复。
// - 计数经 rateStore 固窗（rl 域）：Redis 可用时跨重启持久；不可用自动降级内存镜像（同固窗语义）。
//   日计数键含 Asia/Shanghai 日期，配合 24h TTL 自然轮转。
// - 上限刻意宽松，防 NAT 用户误伤——兜的是「轮换攻击」，不是正常游客用量。
import { incrWindow } from '#server/utils/rateStore'

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

/** 日计数窗口（秒）：24h，与日期键配合自然轮转 */
const DAILY_WINDOW_SEC = 86_400

/** 当前日期（Asia/Shanghai，与 guestOssLimit 同口径） */
function dateStr(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' })
}

/**
 * 通用日计数检查：incr 后 count<=cap 放行。
 * 与原内存版「先查 used>=cap 拒绝否则 +1」等价——每日至多 cap 次成功，第 cap+1 次起拒绝。
 */
async function checkDaily(id: string, cap: number): Promise<boolean> {
  const { count } = await incrWindow('rl', id, DAILY_WINDOW_SEC)
  return count <= cap
}

/** 单 IP 当日游客音频获取：计数 +1 并返回是否放行（超上限拒绝） */
export async function checkGuestAudioByIp(ip: string): Promise<boolean> {
  return checkDaily(`guest-audio:${ip}:${dateStr()}`, IP_AUDIO_DAILY_CAP)
}

/** 单 IP 当日游客评测发放：计数 +1 并返回是否放行（超上限拒绝） */
export async function checkGuestEvalByIp(ip: string): Promise<boolean> {
  return checkDaily(`guest-eval:${ip}:${dateStr()}`, IP_EVAL_DAILY_CAP)
}

/** 单 IP 当日游客录音上传：计数 +1 并返回是否放行（P4-A1） */
export async function checkGuestUploadByIp(ip: string): Promise<boolean> {
  return checkDaily(`guest-upload:${ip}:${dateStr()}`, IP_UPLOAD_DAILY_CAP)
}

/** 单指纹当日游客录音上传：计数 +1 并返回是否放行（P4-A1，防换指纹绕 IP 上限） */
export async function checkGuestUploadByFp(fingerprint: string): Promise<boolean> {
  return checkDaily(`guest-fp:${fingerprint}:${dateStr()}`, FP_UPLOAD_DAILY_CAP)
}

/**
 * 铸键频率：同一 IP 1 次/分钟（guest_token 免费签发防轮换的供给侧限制）。
 * 60s 固窗内 count<=1 放行，等价原「距上次铸键 ≥60s」语义。
 */
export async function checkGuestKeyIssue(ip: string): Promise<boolean> {
  const { count } = await incrWindow('rl', `guest-key:${ip}`, IP_KEY_ISSUE_INTERVAL_MS / 1000)
  return count <= 1
}
