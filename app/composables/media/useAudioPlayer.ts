import { useAudioStore } from '~/store/useAudioStore'
import type { Howl } from 'howler'
import { reportOssPlayback } from '~/api/oss'

// 顶层单例，不响应式
let howl: Howl | null = null
let rafId: number | null = null
let retryTimer: ReturnType<typeof setTimeout> | null = null

/** HTML5 媒体下载失败的错误码（含 OSS 连接超时 net::ERR_CONNECTION_TIMED_OUT 等瞬时网络类失败） */
export const AUDIO_LOAD_NETWORK_ERROR = 4
/** 网络瞬断最多自动重试次数（不含首次尝试） */
export const AUDIO_LOAD_MAX_RETRIES = 2
/** 重试退避基数（毫秒），实际等待 = AUDIO_LOAD_RETRY_BACKOFF_MS × (attempt+1) */
const AUDIO_LOAD_RETRY_BACKOFF_MS = 800

/**
 * 判断是否应自动重试音频加载失败。
 * 仅对网络类错误（code=4）重试，且未超过重试上限；解码/编码类错误(code 2/3)重试无效，不烧次数。
 * @param error          Howler onloaderror 的 error 码
 * @param currentAttempt 当前已尝试次数（首次为 0）
 */
export function shouldAutoRetryLoad(error: unknown, currentAttempt: number): boolean {
  return error === AUDIO_LOAD_NETWORK_ERROR && currentAttempt < AUDIO_LOAD_MAX_RETRIES
}

export function useAudioPlayer() {
  const store = useAudioStore()

  function clearRetry() {
    if (retryTimer) {
      clearTimeout(retryTimer)
      retryTimer = null
    }
  }

  function stopProgressUpdate() {
    if (rafId) {
      cancelAnimationFrame(rafId)
      rafId = null
    }
  }

  function startProgressUpdate() {
    stopProgressUpdate()
    const update = () => {
      if (howl && store.isPlaying) {
        store.currentTime = howl.seek() as number
        rafId = requestAnimationFrame(update)
      } else {
        stopProgressUpdate()
      }
    }
    rafId = requestAnimationFrame(update)
  }

  function disposeHowl() {
    if (howl) {
      howl.unload()
      howl = null
    }
    stopProgressUpdate()
  }

  // 加载音频（动态导入 Howler，SSR 安全）
  // format: 当 src 为无扩展名的 blob object URL 时，需显式告知 Howler 编码格式，
  //         否则 Howler 无法从 URL 推断编解码器，会误报 "No codec support"（HTML5 实际仍可播放）。
  function buildHowl(
    HowlCtor: typeof Howl,
    src: string,
    options?: { onEnded?: () => void; format?: string | string[] },
    attempt = 0,
  ): Howl {
    return new HowlCtor({
      src: [src],
      ...(options?.format
        ? { format: Array.isArray(options.format) ? options.format : [options.format] }
        : {}),
      html5: true, // 流式播放，边加载边播放
      preload: true,
      onend: () => {
        store.isPlaying = false
        store.currentTime = 0
        stopProgressUpdate()
        options?.onEnded?.()
      },
      onplay: () => {
        store.isPlaying = true
        startProgressUpdate()
      },
      onpause: () => {
        store.isPlaying = false
        stopProgressUpdate()
      },
      onload: () => {
        store.duration = howl?.duration() ?? 0
      },
      onloaderror: (_id: number, error: unknown) => {
        // 网络瞬断（如 OSS 连接超时）自动重试，避免一次瞬时失败该音频永久加载失败；
        // 其它错误（解码/编码等）重试无效，直接报错。
        if (shouldAutoRetryLoad(error, attempt)) {
          store.isPlaying = false
          clearRetry()
          disposeHowl()
          retryTimer = setTimeout(
            async () => {
              const { Howl: H } = await import('howler')
              howl = buildHowl(H, src, options, attempt + 1)
              howl.rate(store.playbackRate)
              howl.volume(store.volume)
            },
            AUDIO_LOAD_RETRY_BACKOFF_MS * (attempt + 1),
          )
          return
        }
        logger.error('音频加载失败:', error)
        store.isPlaying = false
      },
    })
  }

  async function load(src: string, options?: { onEnded?: () => void; format?: string | string[] }) {
    // SSR 保护
    if (!import.meta.client) return

    // 若正在重试或在播，先停掉旧实例
    clearRetry()
    disposeHowl()

    // 动态导入 Howler
    const { Howl: H } = await import('howler')

    // 创建新实例
    howl = buildHowl(H, src, options, 0)

    // 设置初始状态
    store.currentSrc = src
    store.currentTime = 0
    store.duration = howl.duration()

    // 应用已有的播放速度和音量
    howl.rate(store.playbackRate)
    howl.volume(store.volume)

    // OSS 外网播放埋点：仅当播放源为 OSS 签名 URL（aliyuncs.com）时上报一次。
    // 外网下行是 OSS 唯一实际计费项；本地 blob / 非 OSS 源被跳过。fire-and-forget，不阻塞。
    if (src.includes('aliyuncs.com')) {
      void reportOssPlayback()
    }
  }

  // 播放
  function play() {
    if (!howl) return
    howl.play()
  }

  // 暂停
  function pause() {
    if (!howl) return
    howl.pause()
  }

  // 切换播放/暂停
  function togglePlay() {
    if (store.isPlaying) {
      pause()
    } else {
      play()
    }
  }

  // 跳转到指定时间（秒）
  function seek(time: number) {
    if (!howl) return
    howl.seek(time)
    store.currentTime = time
  }

  // 设置播放速度
  function setSpeed(rate: number) {
    store.playbackRate = rate
    if (howl) {
      howl.rate(rate)
    }
  }

  // 设置音量
  function setVolume(vol: number) {
    store.volume = vol
    if (howl) {
      howl.volume(vol)
    }
  }

  // 停止并卸载
  function stop() {
    clearRetry()
    disposeHowl()
    store.currentSrc = null
    store.isPlaying = false
    store.currentTime = 0
    store.duration = 0
  }

  return {
    load,
    play,
    pause,
    togglePlay,
    seek,
    setSpeed,
    setVolume,
    stop,
  }
}
