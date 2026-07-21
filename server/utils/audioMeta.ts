/**
 * 音频元数据提取工具
 *
 * 从 MP3 音频 Buffer 中提取时长和大小信息。
 * 使用 music-metadata 库的 parseBuffer 方法。
 * 纯工具函数，零耦合。
 */

import { parseBuffer } from 'music-metadata'

export interface AudioMeta {
  /** 时长（秒），保留两位小数 */
  duration: number
  /** 文件大小（字节） */
  size: number
}

/**
 * 从音频 Buffer 中提取元数据
 * @param audioBuffer MP3 音频的 Buffer
 * @returns 时长和大小，解析失败返回 null
 */
export async function extractAudioMeta(audioBuffer: Buffer): Promise<AudioMeta | null> {
  try {
    const metadata = await parseBuffer(audioBuffer, { mimeType: 'audio/mpeg' })
    const seconds = metadata.format.duration ?? null
    if (seconds === null) return null
    return {
      duration: Math.round(seconds * 100) / 100,
      size: audioBuffer.length,
    }
  } catch (err) {
    logger.error('[audioMeta] 元数据提取失败:', err instanceof Error ? err.message : err)
    return null
  }
}
