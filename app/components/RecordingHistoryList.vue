<script setup lang="ts">
import type { Recording } from '#shared/types/recording'

const props = withDefaults(
  defineProps<{
    recordings: Recording[]
    total: number
    selectedId: number | null
    isLoading: boolean
    isError: boolean
    errorMsg: string
    hasMore: boolean
    isLoadingMore: boolean
    /** 卡片标题（Phase3「历史录音」/ Phase4「历史跟读」） */
    title?: string
    /** 空列表提示文案 */
    emptyText?: string
    /** 是否禁用播放按钮（Phase4 跟读进行中传 true） */
    playDisabled?: boolean
    /** 是否展示选中后的播放按钮 */
    showPlay?: boolean
  }>(),
  {
    title: '历史录音',
    emptyText: '还没有录音，点击下方按钮开始录制',
    playDisabled: false,
    showPlay: true,
  },
)

const emit = defineEmits<{
  (e: 'select', id: number): void
  (e: 'loadMore' | 'retry' | 'play'): void
}>()

function formatDuration(seconds: number | null): string {
  if (seconds === null || seconds === undefined) return '00:00'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

const dateFormatter = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

const hasSelected = computed(() => props.recordings.some((r) => r.id === props.selectedId))
</script>

<template>
  <div class="card">
    <div class="card__header">
      <span>{{ title }}</span>
      <span class="recording-count">{{ total }} 条</span>
    </div>

    <div v-if="isLoading" class="card__body empty-state">
      <DotPulse />
    </div>

    <div v-else-if="isError" class="card__body empty-state">
      <p>{{ errorMsg }}</p>
      <button class="retry-btn--small" @click="emit('retry')">重新加载</button>
    </div>

    <div v-else-if="recordings.length === 0" class="card__body empty-state">
      <p>{{ emptyText }}</p>
    </div>

    <div v-else class="recording-list">
      <div
        v-for="item in recordings"
        :key="item.id"
        class="recording-item"
        :class="{ 'recording-item--selected': item.id === selectedId }"
        @click="emit('select', item.id)"
      >
        <div class="recording-item__info">
          <span class="recording-item__time">{{ formatDuration(item.duration) }}</span>
          <span v-if="item.score !== null" class="recording-item__score">
            {{ item.score }} 分
          </span>
        </div>
        <div class="recording-item__date">
          {{ dateFormatter.format(new Date(item.createdAt)) }}
        </div>
      </div>

      <!-- 加载更多 -->
      <div v-if="hasMore" class="load-more-wrap">
        <button class="load-more-btn" :disabled="isLoadingMore" @click="emit('loadMore')">
          <template v-if="isLoadingMore">
            <DotPulse />
          </template>
          <template v-else> 查看更多（共 {{ total }} 条） </template>
        </button>
      </div>

      <!-- 选中录音的操作按钮 -->
      <div v-if="showPlay && hasSelected" class="selected-actions">
        <button class="selected-action-btn" :disabled="playDisabled" @click="emit('play')">
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M8 5v14l11-7z" />
          </svg>
          播放录音
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.card {
  background: var(--bg);
  border-radius: var(--r);
  padding: 16px;
}

.card__header {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-1);
  margin-bottom: 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.card__body {
  font-size: 14px;
  color: var(--text-2);
  line-height: 1.6;
}

.recording-count {
  font-size: 12px;
  font-weight: 400;
  color: var(--text-3);
}

.empty-state {
  text-align: center;
  padding: 20px;
  color: var(--text-3);
  font-size: 13px;
}

.recording-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.recording-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px;
  background: var(--card);
  border: 1px solid var(--border-ll);
  border-radius: var(--r);
  cursor: pointer;
  transition:
    border-color 0.2s,
    background 0.2s;
}

.recording-item:hover {
  border-color: var(--primary);
}

.recording-item--selected {
  border-color: var(--primary);
  background: rgba(64, 158, 255, 0.05);
}

.recording-item__info {
  display: flex;
  align-items: center;
  gap: 12px;
}

.recording-item__time {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-1);
  font-family: 'Courier New', monospace;
}

.recording-item__score {
  font-size: 12px;
  color: var(--success);
  font-weight: 600;
}

.recording-item__date {
  font-size: 12px;
  color: var(--text-3);
}

.selected-actions {
  display: flex;
  gap: 10px;
  margin-top: 4px;
}

.selected-action-btn {
  flex: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 10px;
  background: var(--card);
  border: 1px solid var(--border-ll);
  border-radius: var(--r);
  color: var(--text-2);
  font-size: 13px;
  cursor: pointer;
  transition:
    background 0.2s,
    opacity 0.2s;
}

.selected-action-btn svg {
  width: 16px;
  height: 16px;
}

.selected-action-btn:not(:disabled):active {
  background: var(--bg);
}

.selected-action-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.load-more-wrap {
  text-align: center;
  padding-top: 8px;
}

.load-more-btn {
  padding: 6px 16px;
  background: var(--card);
  border: 1px solid var(--border-ll);
  border-radius: var(--r);
  color: var(--primary);
  font-size: 12px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  transition:
    background 0.2s,
    opacity 0.2s;
}

.load-more-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.load-more-btn:not(:disabled):active {
  background: var(--primary-light);
}

.retry-btn--small {
  margin-top: 8px;
  padding: 6px 14px;
  font-size: 13px;
  background: var(--card);
  border: 1px solid var(--border-ll);
  border-radius: var(--r);
  color: var(--text-2);
  cursor: pointer;
}
</style>
