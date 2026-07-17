/**
 * Edge TTS 文本转语音工具
 *
 * 基于 Microsoft Edge 在线 TTS 服务的 WebSocket 协议实现。
 * 输入英文文本，输出 MP3 音频 Buffer。
 * 纯工具函数，零耦合，无外部 API Key 依赖。
 *
 * 协议参考: rany2/edge-tts (Python)
 * 音频格式: audio-24khz-48kbitrate-mono-mp3 (48kbps CBR)
 */

import crypto from 'node:crypto'
import WebSocket from 'ws'

// ==================== 常量 ====================

/** Edge TTS WebSocket 基础 URL */
const WSS_BASE = 'wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1'

/** Edge TTS 固定可信令牌 */
const TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4'

/** Chromium 版本（用于 User-Agent 和 Sec-MS-GEC-Version） */
const CHROMIUM_VERSION = '143.0.3650.75'

/** 默认语音 */
const DEFAULT_VOICE = 'en-US-AriaNeural'

/** 单次连接超时（毫秒） */
const CONNECT_TIMEOUT = 30_000

/** 文本分块最大字节数 */
const MAX_CHUNK_BYTES = 4096

/** Windows File Time epoch 与 Unix epoch 的秒数差 (1601-01-01 vs 1970-01-01) */
const WIN_EPOCH_OFFSET = 11644473600

// ==================== 导出类型 ====================

export interface TtsResult {
  /** 是否转换成功 */
  success: boolean
  /** 成功时的 MP3 音频数据 */
  audio?: Buffer
  /** 失败时的错误原因 */
  error?: string
}

// ==================== 内部工具函数 ====================

/**
 * 生成 Sec-MS-GEC 令牌
 * 基于 Windows File Time + TrustedClientToken 的 SHA256 哈希
 */
function generateSecMsGec(): string {
  const ticks = Date.now() / 1000
  const adjustedTicks = ticks + WIN_EPOCH_OFFSET
  const flooredTicks = adjustedTicks - (adjustedTicks % 300)
  const nanos100 = Math.floor(flooredTicks * 1e9 / 100)
  const payload = `${nanos100}${TRUSTED_CLIENT_TOKEN}`
  return crypto.createHash('sha256').update(payload, 'ascii').digest('hex').toUpperCase()
}

/**
 * 将短语音名转换为 Edge TTS 完整语音名
 * en-US-AriaNeural → Microsoft Server Speech Text to Speech Voice (en-US, AriaNeural)
 */
function toFullVoiceName(shortName: string): string {
  const match = /^([a-z]{2}-[A-Z]{2})-(.+)$/.exec(shortName)
  if (!match) return shortName
  return `Microsoft Server Speech Text to Speech Voice (${match[1]}, ${match[2]})`
}

/**
 * XML 特殊字符转义
 */
function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/**
 * 文本清洗：移除不兼容 Unicode 字符 + XML 转义
 */
function sanitizeText(text: string): string {
  const cleaned = text.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, ' ')
  return escapeXml(cleaned)
}

/**
 * 将长文本按字节数分块，优先在换行符和空格处分割
 * 不断开 UTF-8 多字节字符和 XML 实体
 */
function splitText(text: string, maxBytes: number = MAX_CHUNK_BYTES): string[] {
  if (Buffer.byteLength(text, 'utf-8') <= maxBytes) {
    return [text]
  }

  const chunks: string[] = []
  let remaining = text

  while (remaining.length > 0) {
    if (Buffer.byteLength(remaining, 'utf-8') <= maxBytes) {
      chunks.push(remaining)
      break
    }

    // 从 maxBytes 位置向前寻找安全分割点
    let splitPos = maxBytes
    while (splitPos > 0) {
      const byteLen = Buffer.byteLength(remaining.slice(0, splitPos), 'utf-8')
      if (byteLen <= maxBytes) break
      splitPos--
    }

    // 向前寻找换行符或空格作为分割点
    let bestPos = splitPos
    for (let i = splitPos; i >= Math.max(splitPos - 200, 0); i--) {
      const ch = remaining[i]
      if (ch === '\n' || ch === ' ') {
        bestPos = i + 1
        break
      }
    }

    // 检查是否在 XML 实体中间分割（&...;）
    const chunk = remaining.slice(0, bestPos)
    const lastAmp = chunk.lastIndexOf('&')
    const lastSemi = chunk.lastIndexOf(';')
    if (lastAmp !== -1 && lastSemi < lastAmp) {
      // 在实体中间，回退到 & 之前
      bestPos = lastAmp
    }

    chunks.push(remaining.slice(0, bestPos))
    remaining = remaining.slice(bestPos)
  }

  return chunks
}

/**
 * 构造 SSML
 */
function buildSsml(text: string, fullVoice: string): string {
  return `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>
  <voice name='${fullVoice}'>
    <prosody pitch='+0Hz' rate='+0%' volume='+0%'>
      ${text}
    </prosody>
  </voice>
</speak>`
}

/**
 * 生成 Edge TTS 风格的时间戳字符串
 * 例: Thu Jul 16 2026 12:34:56 GMT+0000 (Coordinated Universal Time)
 */
function toEdgeTimestamp(): string {
  const d = new Date()
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${days[d.getUTCDay()]} ${months[d.getUTCMonth()]} ${d.getUTCDate()} ${d.getUTCFullYear()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} GMT+0000 (Coordinated Universal Time)`
}

/**
 * 构造 speech.config 配置消息
 */
function buildConfigMessage(): string {
  const timestamp = toEdgeTimestamp()
  const headers = [
    `X-Timestamp:${timestamp}\r\n`,
    'Content-Type:application/json; charset=utf-8\r\n',
    'Path:speech.config\r\n',
    '\r\n',
    '{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"true","wordBoundaryEnabled":"false"},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}\r\n',
  ]
  return headers.join('')
}

/**
 * 构造 SSML 请求消息
 * 注意: X-Timestamp 后面多一个 Z（Edge TTS 的 bug，必须保留）
 */
function buildSsmlMessage(requestId: string, ssml: string): string {
  const timestamp = toEdgeTimestamp()
  const headers = [
    `X-RequestId:${requestId}\r\n`,
    'Content-Type:application/ssml+xml\r\n',
    `X-Timestamp:${timestamp}Z\r\n`,
    'Path:ssml\r\n',
    '\r\n',
    `${ssml}\r\n`,
  ]
  return headers.join('')
}

/**
 * 构造完整的 WebSocket URL（含认证参数）
 */
function generateWsUrl(): string {
  const connectionId = crypto.randomUUID().replace(/-/g, '')
  const secMsGec = generateSecMsGec()
  return [
    `${WSS_BASE}?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}`,
    `&ConnectionId=${connectionId}`,
    `&Sec-MS-GEC=${secMsGec}`,
    `&Sec-MS-GEC-Version=1-${CHROMIUM_VERSION}`,
  ].join('')
}

/**
 * 生成无横线的 UUID（用于 X-RequestId）
 */
function generateRequestId(): string {
  return crypto.randomUUID().replace(/-/g, '')
}

/**
 * 从文本消息中解析 Path 字段
 */
function parseMessagePath(message: string): string | null {
  const match = /^Path:(.+?)(\r\n|$)/m.exec(message)
  if (!match || !match[1]) return null
  return match[1].trim()
}

/**
 * 从二进制消息中提取 MP3 音频数据
 * 格式: [2字节 header_length][header_length 字节 header][\r\n\r\n][MP3 数据]
 */
function extractAudioData(data: Buffer): Buffer | null {
  if (data.length < 2) return null

  const headerLength = data.readUInt16BE(0)
  // 协议结构: [0:2] headerLength(含自身2字节) | [2:headerLength] 头部 | [headerLength:headerLength+2] \r\n\r\n | [headerLength+2:] 音频
  // 对照 edge-tts Python 源码 communicate.py:71 — data[header_length + 2:]
  const payloadStart = headerLength + 2
  if (data.length <= payloadStart) {
    // 这是音频流终止标记（无 Content-Type 的空音频消息）
    return null
  }

  return data.slice(payloadStart)
}

// ==================== 核心导出函数 ====================

/**
 * 将英文文本转换为 MP3 音频
 * @param text  待转换的英文文本
 * @param voice 语音名称（短名，如 en-US-AriaNeural），默认 en-US-AriaNeural
 * @returns 转换结果，成功时包含 audio Buffer
 */
export async function textToSpeech(text: string, voice: string = DEFAULT_VOICE): Promise<TtsResult> {
  // 1. 校验输入
  const trimmed = text.trim()
  if (!trimmed) {
    return { success: false, error: '文本不能为空' }
  }

  const fullVoice = toFullVoiceName(voice)
  const sanitized = sanitizeText(trimmed)
  const chunks = splitText(sanitized)

  // 2. 准备连接
  const url = generateWsUrl()
  const wsHeaders: Record<string, string> = {
    'Pragma': 'no-cache',
    'Cache-Control': 'no-cache',
    'Origin': 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
    'User-Agent': `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROMIUM_VERSION} Safari/537.36 Edg/${CHROMIUM_VERSION}`,
    'Accept-Language': 'en-US,en;q=0.9',
  }

  let ws: WebSocket | null = null
  const audioChunks: Buffer[] = []

  try {
    // 3. 建立连接（带超时）
    ws = await new Promise<WebSocket>((resolve, reject) => {
      const socket = new WebSocket(url, { headers: wsHeaders })

      const timeout = setTimeout(() => {
        socket.terminate()
        reject(new Error('连接超时'))
      }, CONNECT_TIMEOUT)

      socket.on('open', () => {
        clearTimeout(timeout)
        resolve(socket)
      })

      socket.on('error', (err) => {
        clearTimeout(timeout)
        reject(err)
      })
    })

    // 4. 发送配置消息
    ws.send(buildConfigMessage())

    // 5. 等待一小段时间让服务端处理配置
    await new Promise<void>((resolve) => setTimeout(resolve, 100))

    // 6. 依次处理每个分块
    for (let i = 0; i < chunks.length; i++) {
      const requestId = generateRequestId()
      const chunk = chunks[i]
      if (!chunk) break
      const ssml = buildSsml(chunk, fullVoice)
      const ssmlMessage = buildSsmlMessage(requestId, ssml)

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('TTS 转换超时'))
        }, CONNECT_TIMEOUT)

        let turnEnded = false

        const onMessage = (data: WebSocket.Data, isBinary: boolean) => {
          if (!isBinary) {
            // 文本帧：解析 Path
            const text = (data as Buffer).toString('utf-8')
            const path = parseMessagePath(text)
            if (path === 'turn.end') {
              turnEnded = true
              clearTimeout(timeout)
              ws!.off('message', onMessage)
              ws!.off('error', onError)
              ws!.off('close', onClose)
              resolve()
            }
          } else {
            // 二进制帧：提取音频数据
            const audioData = extractAudioData(data as Buffer)
            if (audioData && audioData.length > 0) {
              audioChunks.push(audioData)
            }
          }
        }

        const onError = (err: Error) => {
          clearTimeout(timeout)
          ws!.off('message', onMessage)
          ws!.off('error', onError)
          ws!.off('close', onClose)
          reject(err)
        }

        const onClose = () => {
          clearTimeout(timeout)
          ws!.off('message', onMessage)
          ws!.off('error', onError)
          ws!.off('close', onClose)
          if (!turnEnded) {
            reject(new Error('WebSocket 连接意外关闭'))
          }
        }

        ws!.on('message', onMessage)
        ws!.on('error', onError)
        ws!.on('close', onClose)
        ws!.send(ssmlMessage)
      })
    }

    // 7. 拼接音频并返回
    if (audioChunks.length === 0) {
      return { success: false, error: 'TTS 转换未返回音频数据' }
    }

    return { success: true, audio: Buffer.concat(audioChunks) }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    console.error('[tts] 转换失败:', errMsg)

    if (errMsg.includes('403') || errMsg.includes('ECONNREFUSED') || errMsg.includes('连接超时')) {
      return { success: false, error: 'TTS 服务连接失败，可能需要代理' }
    }
    if (errMsg.includes('超时')) {
      return { success: false, error: 'TTS 转换超时' }
    }
    return { success: false, error: `TTS 转换失败: ${errMsg}` }
  } finally {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      ws.close()
    }
  }
}