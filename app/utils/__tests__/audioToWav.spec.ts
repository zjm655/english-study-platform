import { describe, it, expect, beforeAll } from 'vitest'
import { toWav16kMono } from '~/utils/audioToWav'

// ── 模拟 Web Audio API（happy-dom 不实现 decode/OfflineAudioContext）──

class MockAudioBuffer {
  duration: number
  private data: Float32Array
  constructor(duration: number, frames: number) {
    this.duration = duration
    this.data = new Float32Array(frames)
  }
  getChannelData() {
    return this.data
  }
}

class MockAudioContext {
  async decodeAudioData(_buf: ArrayBuffer): Promise<MockAudioBuffer> {
    // 模拟解出 1 秒音频
    return new MockAudioBuffer(1, 48000)
  }
  async close() {}
}

class MockOfflineAudioContext {
  length: number
  sampleRate: number
  destination = {}
  constructor(_channels: number, length: number, sampleRate: number) {
    this.length = length
    this.sampleRate = sampleRate
  }
  createBufferSource() {
    return { buffer: null, connect() {}, start() {} }
  }
  async startRendering(): Promise<MockAudioBuffer> {
    return new MockAudioBuffer(this.length / this.sampleRate, this.length)
  }
}

function readString(view: DataView, offset: number, len: number): string {
  let s = ''
  for (let i = 0; i < len; i++) s += String.fromCharCode(view.getUint8(offset + i))
  return s
}

beforeAll(() => {
  ;(globalThis as unknown as { window: unknown }).window = globalThis
  ;(globalThis as unknown as { AudioContext: unknown }).AudioContext = MockAudioContext
  ;(globalThis as unknown as { OfflineAudioContext: unknown }).OfflineAudioContext =
    MockOfflineAudioContext
})

describe('toWav16kMono', () => {
  it('产出 audio/wav Blob，含合法 WAV 头且采样率 16kHz 单声道 16-bit', async () => {
    const input = new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'audio/webm' })
    const wav = await toWav16kMono(input)

    expect(wav.type).toBe('audio/wav')

    const buf = await wav.arrayBuffer()
    const view = new DataView(buf)

    // RIFF / WAVE / fmt / data 标识
    expect(readString(view, 0, 4)).toBe('RIFF')
    expect(readString(view, 8, 4)).toBe('WAVE')
    expect(readString(view, 12, 4)).toBe('fmt ')
    expect(readString(view, 36, 4)).toBe('data')

    // fmt: PCM(1), 单声道(1), 16kHz, 16-bit
    expect(view.getUint16(20, true)).toBe(1)
    expect(view.getUint16(22, true)).toBe(1)
    expect(view.getUint32(24, true)).toBe(16000)
    expect(view.getUint16(34, true)).toBe(16)

    // data 大小 = 16000 帧 * 2 字节；总大小 = 44 + data
    expect(view.getUint32(40, true)).toBe(16000 * 2)
    expect(buf.byteLength).toBe(44 + 16000 * 2)
  })
})
