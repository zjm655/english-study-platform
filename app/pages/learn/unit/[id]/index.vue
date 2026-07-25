<script setup lang="ts">
import { Check } from '@element-plus/icons-vue'
import { useUnitProgress } from '~/composables/unit'
import { useFavorites } from '~/composables/useFavorites'
import type { UnitProgressDetail } from '#shared/types/unit'

definePageMeta({
  title: '单元详情',
})

const route = useRoute()
const unitId = computed(() => Number(route.params.id))

const { isLoading, isLoadingMore, fetchUnitProgress, loadMore } = useUnitProgress()
const { fetchFavSegments, isSegmentFav, toggleSegment, togglingSegment } = useFavorites()

const unitData = ref<UnitProgressDetail['unit'] | null>(null)

// SEO：title 响应式 getter，数据晚到前用静态兜底
useSeoMeta({
  title: () => unitData.value?.title ?? '单元详情',
  description: () =>
    unitData.value?.description ??
    '浏览单元内全部学习片段，逐个完成盲听、学习、配音、跟读四阶段训练。',
})
useJsonLd(
  learningResourceSchema({
    name: '英语听说训练单元',
    description: '包含盲听、学习、配音、影子跟读四阶段训练的英语学习单元。',
  }),
)
const segments = ref<UnitProgressDetail['segments']>([])
const error = ref<string | null>(null)

// 分页状态（服务端默认每页 10 条）
const page = ref(1)
const hasMore = ref(true)
const sentinelRef = ref<HTMLElement | null>(null)

let scrollObserver: IntersectionObserver | null = null

async function loadData() {
  error.value = null
  page.value = 1
  hasMore.value = true
  const res = await fetchUnitProgress(unitId.value)
  if (res?.code === 200 && res.data) {
    unitData.value = res.data.unit
    segments.value = res.data.segments
    hasMore.value = res.data.pagination.hasMore
  } else {
    error.value = res?.message || '加载失败'
  }
}

async function loadMoreSegments() {
  if (!hasMore.value || isLoadingMore.value) return
  const res = await loadMore(unitId.value, page.value + 1)
  if (res?.code === 200 && res.data) {
    segments.value.push(...res.data.segments)
    page.value++
    hasMore.value = res.data.pagination.hasMore
  }
}

onMounted(() => {
  loadData()
  fetchFavSegments()

  scrollObserver = new IntersectionObserver(
    (entries) => {
      const entry = entries[0]
      if (entry?.isIntersecting && hasMore.value && !isLoadingMore.value) {
        loadMoreSegments()
      }
    },
    { rootMargin: '0px 0px 100px 0px' },
  )

  if (sentinelRef.value) {
    scrollObserver.observe(sentinelRef.value)
  }
})

onBeforeUnmount(() => {
  scrollObserver?.disconnect()
})

function getSegmentPhases(segment: UnitProgressDetail['segments'][number]) {
  return [
    { phase: 1, name: '盲听', done: segment.progress.phase1_done },
    { phase: 2, name: '学习', done: segment.progress.phase2_done },
    { phase: 3, name: '配音', done: segment.progress.phase3_done },
    { phase: 4, name: '跟读', done: segment.progress.phase4_done },
  ]
}

function getCurrentPhaseIndex(phases: { done: boolean }[]) {
  return phases.findIndex((p) => !p.done)
}
</script>

<template>
  <div class="unit-detail-page">
    <!-- Loading -->
    <div v-if="isLoading" class="loading-container">
      <DotPulse />
    </div>

    <!-- Error -->
    <div v-else-if="error" class="error-container">
      <div class="error-text">{{ error }}</div>
      <button class="retry-btn" @click="loadData">重试</button>
    </div>

    <!-- Empty -->
    <div v-else-if="!segments.length" class="empty-state">暂无片段数据</div>

    <!-- Content -->
    <template v-else>
      <div class="unit-header">
        <h2 class="unit-header__title">{{ unitData?.title }}</h2>
        <p v-if="unitData?.description" class="unit-header__desc">{{ unitData.description }}</p>
      </div>

      <div class="segment-list">
        <div
          v-for="segment in segments"
          :key="segment.id"
          class="segment-card"
          :class="{ 'segment-card--mine': segment.isMine }"
        >
          <NuxtLink :to="`/learn/unit/${unitId}/segment/${segment.id}`" class="segment-card__link">
            <div class="segment-card__header">
              <span v-if="segment.isMine" class="segment-card__badge">我的</span>
              <div class="segment-card__title">{{ segment.title }}</div>
            </div>
            <div class="segment-card__phases">
              <div
                v-for="(item, idx) in getSegmentPhases(segment)"
                :key="item.phase"
                class="phase-dot"
                :class="{
                  'phase-dot--done': item.done,
                  'phase-dot--current':
                    !item.done && getCurrentPhaseIndex(getSegmentPhases(segment)) === idx,
                }"
              >
                <div class="phase-dot__icon">
                  <el-icon v-if="item.done"><Check /></el-icon>
                  <span v-else>{{ item.phase }}</span>
                </div>
                <div class="phase-dot__name">{{ item.name }}</div>
              </div>
            </div>
          </NuxtLink>

          <button
            class="segment-fav-btn"
            :class="{ 'segment-fav-btn--active': isSegmentFav(segment.id) }"
            :disabled="togglingSegment === segment.id"
            @click="toggleSegment(segment.id)"
          >
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path
                d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"
              />
            </svg>
          </button>
        </div>

        <!-- 底部加载提示 -->
        <div v-if="isLoadingMore" class="list-footer">加载中…</div>
        <div v-else-if="!hasMore && segments.length" class="list-footer">没有更多了</div>

        <!-- 无限滚动哨兵 -->
        <div ref="sentinelRef" class="sentinel" />
      </div>
    </template>
  </div>
</template>

<style scoped>
.unit-detail-page {
  padding: 16px;
  min-height: 100%;
}

/* ===== 单元标题 ===== */
.unit-header {
  margin-bottom: 20px;
}

.unit-header__title {
  font-size: 18px;
  font-weight: 600;
  color: var(--text-1);
  margin-bottom: 4px;
}

.unit-header__desc {
  font-size: 13px;
  color: var(--text-3);
  line-height: 1.5;
}

/* ===== Loading ===== */
.loading-container {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 60vh;
}

/* ===== Error ===== */
.error-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 40vh;
  gap: 16px;
}

.error-text {
  font-size: 14px;
  color: var(--text-3);
}

.retry-btn {
  padding: 10px 28px;
  background: var(--primary);
  color: #fff;
  border: none;
  border-radius: var(--r);
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: opacity 0.2s;
}

.retry-btn:active {
  opacity: 0.85;
}

/* ===== 空状态 ===== */
.empty-state {
  text-align: center;
  padding: 24px;
  font-size: 14px;
  color: var(--text-3);
}

/* ===== 片段卡片列表 ===== */
.segment-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.segment-card {
  position: relative;
  padding: 16px;
  background: var(--card);
  border-radius: var(--r-lg);
  box-shadow: var(--shadow);
  transition: transform 0.2s;
}

.segment-card:active {
  transform: scale(0.98);
}

.segment-card__link {
  display: flex;
  flex-direction: column;
  gap: 12px;
  text-decoration: none;
  color: inherit;
}

.segment-card__title {
  font-size: 15px;
  font-weight: 500;
  color: var(--text-1);
}

.segment-card__header {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 8px;
}

/* 自己的材料：淡背景高亮 + 「我的」角标 */
.segment-card--mine {
  /* background: var(--primary-light); */
  background: #f6f6f70d;
  border: 1px solid color-mix(in srgb, var(--primary) 25%, transparent);
}

.segment-card__badge {
  flex-shrink: 0;
  font-size: 11px;
  line-height: 1;
  padding: 2px 6px;
  border-radius: 4px;
  background: var(--primary);
  color: #fff;
}

/* 列表底部加载提示 */
.list-footer {
  text-align: center;
  padding: 12px;
  font-size: 12px;
  color: var(--text-3);
}

.segment-fav-btn {
  position: absolute;
  top: 14px;
  right: 14px;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  color: var(--text-3);
  cursor: pointer;
  transition: all 0.2s;
  padding: 0;
  z-index: 1;
}

.segment-fav-btn svg {
  width: 18px;
  height: 18px;
}

.segment-fav-btn:hover:not(:disabled) {
  /* color: var(--warning); */
  transform: scale(1.1);
}
.segment-fav-btn:active:not(:disabled) {
  color: var(--warning);
  transform: scale(1.1);
}

.segment-fav-btn:active:not(:disabled) {
  transform: scale(0.95);
}

.segment-fav-btn--active {
  color: var(--warning);
}

.segment-fav-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* ===== 四阶段进度圆点 ===== */
.segment-card__phases {
  display: flex;
  justify-content: center;
  gap: 24px;
  padding: 0 8px;
}

.phase-dot {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}

.phase-dot__icon {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 600;
  background: var(--border-ll);
  color: var(--text-3);
  transition: all 0.3s;
}

.phase-dot--done .phase-dot__icon {
  background: var(--success);
  color: #fff;
}

.phase-dot--current .phase-dot__icon {
  background: var(--primary);
  color: #fff;
  box-shadow: 0 0 0 4px rgba(64, 158, 255, 0.2);
}

.phase-dot__name {
  font-size: 11px;
  color: var(--text-3);
}

.phase-dot--done .phase-dot__name,
.phase-dot--current .phase-dot__name {
  color: var(--text-1);
  font-weight: 500;
}

/* 无限滚动哨兵 */
.sentinel {
  height: 1px;
}
</style>
