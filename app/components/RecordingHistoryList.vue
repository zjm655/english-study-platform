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
    /** 当前正在重试分析的录音 ID（用于禁用重试按钮 + 显示 loading） */
    retryingId?: number | null
  }>(),
  {
    title: '历史录音',
    emptyText: '还没有录音，点击下方按钮开始录制',
    playDisabled: false,
    showPlay: true,
    retryingId: null,
  },
)

const emit = defineEmits<{
  (e: 'select', id: number): void
  (e: 'loadMore' | 'retry' | 'play'): void
  (e: 'retry-analyze', item: Recording): void
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

/** 当前选中的录音对象（用于读取 analyzeStatus 判断是否显示重试按钮） */
const selectedRecording = computed(
  () => props.recordings.find((r) => r.id === props.selectedId) || null,
)
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
          <span
            v-if="item.analyzeStatus === 'failed'"
            class="recording-item__badge recording-item__badge--failed"
          >
            分析失败
          </span>
          <span
            v-else-if="item.analyzeStatus === 'pending'"
            class="recording-item__badge recording-item__badge--pending"
          >
            待分析
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
        <button
          v-if="selectedRecording?.analyzeStatus === 'failed'"
          class="selected-action-btn selected-action-btn--retry"
          :disabled="retryingId === selectedRecording?.id"
          @click="selectedRecording && emit('retry-analyze', selectedRecording)"
        >
          <template v-if="retryingId === selectedRecording?.id">
            <DotPulse />
          </template>
          <template v-else>
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path
                d="M17.65 6.35A7.958 7.958 0 0012 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0112 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"
              />
            </svg>
            重试分析
          </template>
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

.recording-item__badge {
  font-size: 11px;
  font-weight: 500;
  padding: 1px 6px;
  border-radius: 4px;
  line-height: 1.5;
}

.recording-item__badge--failed {
  color: var(--danger);
  background: rgba(245, 108, 108, 0.1);
}

.recording-item__badge--pending {
  color: var(--warning);
  background: var(--warning-light);
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

.selected-action-btn--retry {
  color: var(--warning);
}

.selected-action-btn--retry:not(:disabled):active {
  background: var(--warning-light);
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
