// app/utils/fingerprint.ts
// 游客浏览器指纹生成：为游客录音上传提供身份标识（x-guest-fingerprint header）。
//
// 设计要点：
// - 基于 canvas + userAgent + screen + timezone 等稳定因子生成 SHA-256 哈希（64 位 hex）
// - localStorage 持久化（key: guest_fp），避免每次重新计算
// - 仅客户端使用（import.meta.client 守卫），SSR 阶段返回空串
// - 指纹用于游客录音归属，非安全凭证（服务端有归属校验兜底）

const STORAGE_KEY = 'guest_fp'

/** 收集浏览器稳定因子拼接为原始字符串 */
function collectSignals(): string {
  const signals: string[] = [
    navigator.userAgent,
    navigator.language,
    `${screen.width}x${screen.height}x${screen.colorDepth}`,
    Intl.DateTimeFormat().resolvedOptions().timeZone ?? '',
    String(new Date().getTimezoneOffset()),
    navigator.hardwareConcurrency?.toString() ?? '',
    navigator.platform ?? '',
  ]

  // Canvas 指纹（2D 渲染差异反映 GPU/字体引擎组合）
  try {
    const canvas = document.createElement('canvas')
    canvas.width = 200
    canvas.height = 50
    const ctx = canvas.getContext('2d')
    if (ctx) {
      ctx.textBaseline = 'top'
      ctx.font = '14px Arial'
      ctx.fillStyle = '#f60'
      ctx.fillRect(0, 0, 200, 50)
      ctx.fillStyle = '#069'
      ctx.fillText('guest-fp-英语平台', 2, 15)
      signals.push(canvas.toDataURL())
    }
  } catch {
    // canvas 不可用（headless/隐私模式）时跳过，不影响其余因子
  }

  return signals.join('|')
}

/** 将原始字符串哈希为 64 位十六进制 SHA-256 */
async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * 获取游客浏览器指纹（64 位 hex SHA-256）。
 * - 首次调用计算并持久化到 localStorage
 * - 后续调用直接读缓存
 * - SSR 阶段返回空串（调用方应跳过）
 */
export async function getGuestFingerprint(): Promise<string> {
  if (!import.meta.client) return ''

  // 优先读 localStorage 缓存
  try {
    const cached = localStorage.getItem(STORAGE_KEY)
    if (cached && /^[a-f0-9]{64}$/.test(cached)) return cached
  } catch {
    // localStorage 不可用（隐私模式）时每次重新计算
  }

  const signals = collectSignals()
  const fingerprint = await sha256Hex(signals)

  // 持久化（best-effort）
  try {
    localStorage.setItem(STORAGE_KEY, fingerprint)
  } catch {
    // 写入失败不影响本次使用
  }

  return fingerprint
}
