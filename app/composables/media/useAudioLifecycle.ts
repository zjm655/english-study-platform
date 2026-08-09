import { useAudioPlayer } from './useAudioPlayer'

/**
 * 音频生命周期管理
 * - 页面隐藏时暂停播放
 * - 页面恢复时保持暂停（需用户手动点击继续）
 * - 组件销毁时停止并释放资源
 */
export function useAudioLifecycle() {
  const { pause, stop } = useAudioPlayer()

  const handleVisibilityChange = () => {
    if (document.hidden) {
      pause()
    }
    // 页面恢复时不做任何操作，保持暂停状态
  }

  onMounted(() => {
    document.addEventListener('visibilitychange', handleVisibilityChange)
  })

  onBeforeUnmount(() => {
    document.removeEventListener('visibilitychange', handleVisibilityChange)
    stop()
  })
}
