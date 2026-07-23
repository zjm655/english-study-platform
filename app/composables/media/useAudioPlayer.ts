import { useAudioStore } from '~/store/useAudioStore'
import type { Howl } from 'howler'

// 顶层单例，不响应式
let howl: Howl | null = null
let rafId: number | null = null

export function useAudioPlayer() {
  const store = useAudioStore()

  // 加载音频（动态导入 Howler，SSR 安全）
  // format: 当 src 为无扩展名的 blob object URL 时，需显式告知 Howler 编码格式，
  //         否则 Howler 无法从 URL 推断编解码器，会误报 "No codec support"（HTML5 实际仍可播放）。
  async function load(src: string, options?: { onEnded?: () => void; format?: string | string[] }) {
    // SSR 保护
    if (!import.meta.client) return

    // 如果正在播放，先停止
    if (howl) {
      howl.unload()
      stopProgressUpdate()
    }

    // 动态导入 Howler
    const { Howl } = await import('howler')

    // 创建新实例
    howl = new Howl({
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
        logger.error('音频加载失败:', error)
        store.isPlaying = false
      },
    })

    // 设置初始状态
    store.currentSrc = src
    store.currentTime = 0
    store.duration = howl.duration()

    // 应用已有的播放速度和音量
    howl.rate(store.playbackRate)
    howl.volume(store.volume)
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
    if (howl) {
      howl.unload()
      howl = null
    }
    stopProgressUpdate()
    store.currentSrc = null
    store.isPlaying = false
    store.currentTime = 0
    store.duration = 0
  }

  // 使用 requestAnimationFrame 更新进度
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
