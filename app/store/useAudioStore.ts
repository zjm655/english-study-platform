// 音频播放器状态 Store
// 只存储状态，不持有 Howler 实例（实例在 useAudioPlayer hook 中管理）
export const useAudioStore = defineStore('audio', () => {
  // 当前音频源
  const currentSrc = ref<string | null>(null)
  
  // 播放状态
  const isPlaying = ref(false)
  
  // 进度（秒）
  const currentTime = ref(0)
  const duration = ref(0)
  
  // 播放速度（0.5 - 2.0）
  const playbackRate = ref(1)
  
  // 音量（0 - 1）
  const volume = ref(1)
  
  // 重置状态
  function reset() {
    currentSrc.value = null
    isPlaying.value = false
    currentTime.value = 0
    duration.value = 0
    playbackRate.value = 1
    volume.value = 1
  }
  
  return {
    currentSrc,
    isPlaying,
    currentTime,
    duration,
    playbackRate,
    volume,
    reset
  }
})
