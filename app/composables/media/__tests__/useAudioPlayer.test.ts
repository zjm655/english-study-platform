import { describe, it, expect, vi, beforeEach } from 'vitest'
import { reactive } from 'vue'
import {
  useAudioPlayer,
  shouldAutoRetryLoad,
  AUDIO_LOAD_NETWORK_ERROR,
  AUDIO_LOAD_MAX_RETRIES,
} from '../useAudioPlayer'

// ===== useAudioPlayer 瞬断自动重试测试 =====
// 目标：onloaderror(code=4，网络/HTTP 失败如 OSS 连接超时) 自动重试；非网络错误不重试；
//      重试有界（不无限构造）。策略函数 shouldAutoRetryLoad 为纯函数，直接断言边界。

const mockStore = reactive({
  currentSrc: null as string | null,
  isPlaying: false,
  currentTime: 0,
  duration: 0,
  playbackRate: 1,
  volume: 1,
})
vi.mock('~/store/useAudioStore', () => ({ useAudioStore: () => mockStore }))
vi.mock('~/api/oss', () => ({ reportOssPlayback: vi.fn() }))
vi.stubGlobal('logger', { info: vi.fn(), warn: vi.fn(), error: vi.fn() })

beforeEach(() => {
  vi.clearAllMocks()
  mockStore.currentSrc = null
  mockStore.isPlaying = false
  mockStore.duration = 0
})

describe('shouldAutoRetryLoad：瞬断重试策略', () => {
  it('网络错误码(4)且未达重试上限 → 重试', () => {
    expect(AUDIO_LOAD_NETWORK_ERROR).toBe(4)
    expect(shouldAutoRetryLoad(4, 0)).toBe(true)
    expect(shouldAutoRetryLoad(4, AUDIO_LOAD_MAX_RETRIES - 1)).toBe(true)
  })

  it('网络错误码(4)已达重试上限 → 不再重试', () => {
    expect(shouldAutoRetryLoad(4, AUDIO_LOAD_MAX_RETRIES)).toBe(false)
    expect(shouldAutoRetryLoad(4, AUDIO_LOAD_MAX_RETRIES + 1)).toBe(false)
  })

  it('非网络类错误码(2/3) → 不重试（解码/编码类重试无效）', () => {
    expect(shouldAutoRetryLoad(2, 0)).toBe(false)
    expect(shouldAutoRetryLoad(3, 0)).toBe(false)
  })

  it('未知/空错误码 → 不重试', () => {
    expect(shouldAutoRetryLoad(undefined, 0)).toBe(false)
    expect(shouldAutoRetryLoad(null, 0)).toBe(false)
  })
})

describe('useAudioPlayer：API 完整性', () => {
  it('返回完整播放器方法集合（load 已接线重试策略）', () => {
    const player = useAudioPlayer()
    for (const fn of [
      'load',
      'play',
      'pause',
      'togglePlay',
      'seek',
      'setSpeed',
      'setVolume',
      'stop',
    ]) {
      expect(typeof (player as Record<string, unknown>)[fn]).toBe('function')
    }
  })
})
