<script setup lang="ts">
import { useAudioStore } from '~/store/useAudioStore'
import { useAudioPlayer } from '~/composables/media/useAudioPlayer'

interface Props {
  /** 是否显示速度控制 */
  showSpeed?: boolean
  /** 速度选项 */
  speedOptions?: number[]
}

const props = withDefaults(defineProps<Props>(), {
  showSpeed: true,
  speedOptions: () => [0.5, 1, 1.5, 2],
})

const store = useAudioStore()
const { togglePlay, seek, setSpeed } = useAudioPlayer()

// 格式化时间（秒 → mm:ss）
function formatTime(seconds: number): string {
  if (!seconds || !isFinite(seconds)) return '00:00'
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
}

// 进度条点击
function onProgressClick(e: MouseEvent) {
  const target = e.currentTarget as HTMLElement
  const rect = target.getBoundingClientRect()
  const percent = (e.clientX - rect.left) / rect.width
  const time = percent * store.duration
  seek(time)
}

// 切换速度
function cycleSpeed() {
  const currentIndex = props.speedOptions.indexOf(store.playbackRate)
  const nextIndex = (currentIndex + 1) % props.speedOptions.length
  setSpeed(props.speedOptions[nextIndex]!)
}
</script>

<template>
  <div class="audio-player">
    <!-- 播放按钮 -->
    <button class="play-btn" @click="togglePlay">
      <svg v-if="!store.isPlaying" viewBox="0 0 24 24" fill="currentColor">
        <path d="M8 5v14l11-7z" />
      </svg>
      <svg v-else viewBox="0 0 24 24" fill="currentColor">
        <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
      </svg>
    </button>

    <!-- 进度区域 -->
    <div class="progress-area">
      <span class="time">{{ formatTime(store.currentTime) }}</span>
      <div class="progress-bar" @click="onProgressClick">
        <div
          class="progress-fill"
          :style="{ width: `${(store.currentTime / store.duration) * 100}%` }"
        />
      </div>
      <span class="time">{{ formatTime(store.duration) }}</span>
    </div>

    <!-- 速度控制 -->
    <button
      v-if="showSpeed"
      class="speed-btn"
      :class="{ 'speed-btn--active': store.playbackRate !== 1 }"
      @click="cycleSpeed"
    >
      {{ store.playbackRate }}x
    </button>
  </div>
</template>

<style scoped>
.audio-player {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  background: var(--card);
  border-radius: var(--r-lg);
  box-shadow: var(--shadow);
}

/* 播放按钮 */
.play-btn {
  flex-shrink: 0;
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--primary);
  border: none;
  border-radius: 50%;
  color: #fff;
  cursor: pointer;
  transition: opacity 0.2s;
}

.play-btn:active {
  opacity: 0.85;
}

.play-btn svg {
  width: 20px;
  height: 20px;
}

/* 进度区域 */
.progress-area {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.time {
  font-size: 12px;
  color: var(--text-3);
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}

.progress-bar {
  flex: 1;
  height: 4px;
  background: var(--border-ll);
  border-radius: 2px;
  cursor: pointer;
  position: relative;
}

.progress-fill {
  position: absolute;
  left: 0;
  top: 0;
  height: 100%;
  background: var(--primary);
  border-radius: 2px;
  transition: width 0.1s linear;
}

/* 速度按钮 */
.speed-btn {
  flex-shrink: 0;
  padding: 4px 8px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-3);
  background: transparent;
  border: 1px solid var(--border-ll);
  border-radius: var(--r);
  cursor: pointer;
  transition: all 0.2s;
}

.speed-btn:active {
  opacity: 0.85;
}

.speed-btn--active {
  color: var(--primary);
  border-color: var(--primary);
}
</style>
