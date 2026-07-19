/**
 * 音频转码工具：将任意浏览器可解码的音频 Blob 转为 16kHz 单声道 16-bit PCM WAV
 *
 * 背景：MediaRecorder 默认产出 WebM/Opus@48kHz，评测 SDK 的客户端解码链
 * （wav→speex→ogg 16kHz）无法完整解析流式 WebM，只能解出前 ~2s，导致
 * 词级评分几乎全 0。此处用浏览器原生 AudioContext 可靠解码整段音频，
 * 再重采样为评测引擎推荐的 16kHz 单声道 PCM WAV。
 *
 * 纯前端实现，无第三方依赖。仅在 import.meta.client 环境调用。
 */

/**
 * 将音频 Blob 转为 16kHz 单声道 16-bit PCM WAV Blob。
 * @param blob 任意浏览器可解码的音频（webm/ogg/mp3/wav…）
 * @returns `Blob({ type: 'audio/wav' })`
 */
export async function toWav16kMono(blob: Blob): Promise<Blob> {
  const TARGET_RATE = 16000

  const arrayBuffer = await blob.arrayBuffer()

  // 1. 用浏览器原生解码器解出完整 PCM（兼容 WebM/Opus 等流式容器）
  const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
  const decodeCtx = new AudioCtx()
  let decoded: AudioBuffer
  try {
    // slice(0) 传入拷贝，避免部分实现 detach 原 buffer
    decoded = await decodeCtx.decodeAudioData(arrayBuffer.slice(0))
  } finally {
    // 解码用的 context 不再需要，尽快释放
    void decodeCtx.close()
  }

  // 2. 重采样为单声道 16kHz
  const frameCount = Math.ceil(decoded.duration * TARGET_RATE)
  const offline = new OfflineAudioContext(1, frameCount, TARGET_RATE)
  const source = offline.createBufferSource()
  source.buffer = decoded
  source.connect(offline.destination)
  source.start(0)
  const rendered = await offline.startRendering()

  // 3. 编码 16-bit PCM WAV
  return encodeWav(rendered.getChannelData(0), TARGET_RATE)
}

/**
 * 将单声道 Float32 PCM 数据编码为 16-bit PCM WAV Blob（含 44 字节 WAV 头）。
 */
function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const numChannels = 1
  const bytesPerSample = 2 // 16-bit
  const blockAlign = numChannels * bytesPerSample
  const byteRate = sampleRate * blockAlign
  const dataSize = samples.length * bytesPerSample

  const buffer = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buffer)

  // RIFF chunk descriptor
  writeString(view, 0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true) // ChunkSize
  writeString(view, 8, 'WAVE')

  // fmt sub-chunk
  writeString(view, 12, 'fmt ')
  view.setUint32(16, 16, true)          // Subchunk1Size (PCM)
  view.setUint16(20, 1, true)           // AudioFormat = 1 (PCM)
  view.setUint16(22, numChannels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, byteRate, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, bytesPerSample * 8, true) // BitsPerSample

  // data sub-chunk
  writeString(view, 36, 'data')
  view.setUint32(40, dataSize, true)

  // PCM samples：Float32 [-1,1] → 16-bit 有符号整数
  let offset = 44
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]!))
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true)
    offset += bytesPerSample
  }

  return new Blob([view], { type: 'audio/wav' })
}

function writeString(view: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i))
  }
}
