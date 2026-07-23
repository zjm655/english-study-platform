/**
 * 阿里云 NLS 语音转文字工具
 *
 * 调用阿里云智能语音交互服务 FlashRecognizer 接口，
 * 将用户上传的音频（MP3）转为文字。
 *
 * 纯工具函数，零耦合，仅依赖 Nuxt runtimeConfig 中的 NLS 配置。
 */

import RPCClient from '@alicloud/pop-core'
import { fileLog, fileLogError } from './fileLogger'
import { logCloudServiceCall } from './cloudServiceLog'
import { serverFetch } from './request'
import { logger } from '../../shared/utils/logger'

// ==================== 导出类型 ====================

export interface SpeechToTextResult {
  /** 是否识别成功 */
  success: boolean
  /** 识别出的文字（多句拼接） */
  text?: string
  /** 音频时长（毫秒），来自 flash_result.duration */
  duration?: number
  /** 失败时的错误原因 */
  error?: string
}

// ==================== 内部常量与类型 ====================

/** NLS 配置结构 */
interface NlsConfig {
  accessKeyId: string
  accessKeySecret: string
  gateway: string
  appKey: string
}

/** CreateToken 响应结构 */
interface TokenResponse {
  Token: {
    Id: string
    ExpireTime: number
  }
}

/** FlashRecognizer 单句结构 */
interface Sentence {
  text: string
}

/** FlashRecognizer 响应结构 */
interface FlashRecognizerResponse {
  status: number
  message?: string
  flash_result?: {
    duration: number
    sentences: Sentence[]
  }
}

/** Token 缓存 */
interface CachedToken {
  token: string
  expireTime: number
}

/** Token 提前过期缓冲（秒），避免在临界时间使用即将过期的 Token */
const TOKEN_EXPIRY_BUFFER = 60

/** 识别 API 超时（毫秒） */
const _RECOGNIZE_TIMEOUT = 60_000

/** CreateToken 固定参数 */
const TOKEN_ENDPOINT = 'https://nls-meta.cn-shanghai.aliyuncs.com'
const TOKEN_API_VERSION = '2019-02-28'

// ==================== Token 管理 ====================

let cachedToken: CachedToken | null = null

function isTokenValid(): boolean {
  if (!cachedToken) return false
  const nowSec = Date.now() / 1000
  return cachedToken.expireTime > nowSec + TOKEN_EXPIRY_BUFFER
}

async function getToken(config: NlsConfig): Promise<string> {
  if (isTokenValid()) {
    return cachedToken!.token
  }

  const client = new RPCClient({
    endpoint: TOKEN_ENDPOINT,
    apiVersion: TOKEN_API_VERSION,
    accessKeyId: config.accessKeyId,
    accessKeySecret: config.accessKeySecret,
  })

  let callStart = 0
  try {
    callStart = Date.now()
    const result = (await client.request('CreateToken', {})) as TokenResponse
    const token = result.Token.Id
    const expireTime = result.Token.ExpireTime

    cachedToken = { token, expireTime }
    void logCloudServiceCall({
      service: 'nls',
      operation: 'createToken',
      success: true,
      durationMs: Date.now() - callStart,
    })
    return token
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    void logCloudServiceCall({
      service: 'nls',
      operation: 'createToken',
      success: false,
      durationMs: callStart ? Date.now() - callStart : 0,
      errorMessage: errMsg.substring(0, 500),
    })
    throw err
  }
}

// ==================== 核心导出函数 ====================

/**
 * 将音频 Buffer 识别为文字
 * @param audioBuffer 音频数据（支持 MP3/WAV/AAC/OPUS/MP4）
 * @param format 音频格式，默认 mp3
 * @returns 识别结果
 */
export async function speechToText(
  audioBuffer: Buffer,
  format: 'mp3' | 'wav' | 'aac' | 'opus' | 'mp4' = 'mp3',
): Promise<SpeechToTextResult> {
  // 1. 校验输入
  if (!audioBuffer || audioBuffer.length === 0) {
    return { success: false, error: '音频数据不能为空' }
  }

  // 2. 读取配置
  const config = useRuntimeConfig()
  const nls = config.nls as unknown as Partial<NlsConfig>

  if (!nls?.accessKeyId || !nls?.accessKeySecret || !nls?.gateway || !nls?.appKey) {
    logger.error('[speechToText] NLS 配置不完整')
    fileLogError('nls', '[speechToText] NLS 配置不完整')
    return { success: false, error: 'NLS 配置缺失' }
  }

  const fullConfig: NlsConfig = {
    accessKeyId: nls.accessKeyId,
    accessKeySecret: nls.accessKeySecret,
    gateway: nls.gateway,
    appKey: nls.appKey,
  }

  // 3. 获取 Token
  let token: string
  try {
    token = await getToken(fullConfig)
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    logger.error('[speechToText] Token 获取失败:', errMsg)
    fileLogError('nls', '[speechToText] Token 获取失败', errMsg)
    return { success: false, error: 'Token 获取失败' }
  }

  // 4. 调用 FlashRecognizer
  const url = `https://${fullConfig.gateway}/stream/v1/FlashRecognizer?appkey=${fullConfig.appKey}&token=${token}&format=${format}&sample_rate=16000`

  let callStart2 = 0
  try {
    callStart2 = Date.now()
    const resp = await serverFetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
      },
      body: new Uint8Array(audioBuffer),
      timeout: 60000,
      tag: '[speechToText]',
    })

    const data = (await resp.json()) as FlashRecognizerResponse

    if (data.status !== 20000000) {
      const msg = data.message || `识别失败（status: ${data.status}）`
      logger.error('[speechToText] 识别失败:', msg)
      fileLogError('nls', '[speechToText] 识别失败', msg, { status: data.status })
      void logCloudServiceCall({
        service: 'nls',
        operation: 'speechToText',
        success: false,
        durationMs: Date.now() - callStart2,
        errorMessage: msg.substring(0, 500),
      })
      return { success: false, error: msg }
    }

    const sentences = data.flash_result?.sentences ?? []
    const text = sentences.map((s) => s.text).join('')
    const duration = data.flash_result?.duration

    logger.info(
      `[speechToText] 识别成功 (${text.length}字${duration !== undefined ? `, ${duration}ms` : ''})`,
    )
    fileLog('nls', 'info', '[speechToText] 识别成功', { format, textLength: text.length, duration })
    void logCloudServiceCall({
      service: 'nls',
      operation: 'speechToText',
      success: true,
      durationMs: Date.now() - callStart2,
    })
    return {
      success: true,
      text,
      ...(duration !== undefined ? { duration } : {}),
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    logger.error('[speechToText] 识别请求失败:', errMsg)
    fileLogError('nls', '[speechToText] 识别请求失败', errMsg)
    void logCloudServiceCall({
      service: 'nls',
      operation: 'speechToText',
      success: false,
      durationMs: callStart2 ? Date.now() - callStart2 : 0,
      errorMessage: errMsg.substring(0, 500),
    })

    if (errMsg.includes('abort') || errMsg.includes('timeout') || errMsg.includes('Timeout')) {
      return { success: false, error: '语音识别超时' }
    }
    return { success: false, error: '语音识别请求失败' }
  }
}
