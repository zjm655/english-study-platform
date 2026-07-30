<script setup lang="ts">
import { Check } from '@element-plus/icons-vue'
import { useUnitProgress } from '~/composables/unit'
import { useFavorites } from '~/composables/useFavorites'
import { useUserStore } from '~/store/useUserStore'
import { unitsPath } from '~/api/paths'
import type { UnitProgressDetail } from '#shared/types/unit'

definePageMeta({
  title: '单元详情',
})

const route = useRoute()
const unitId = computed(() => Number(route.params.id))
const userStore = useUserStore()

// 首屏走 useAsyncRes（SSR 直出，游客可浏览裁剪版）；失败静默降级页内空态，不弹 toast
const {
  data: detailRes,
  pending,
  error: fetchError,
  refresh,
} = useAsyncRes<UnitProgressDetail | null>(
  () => `unit-progress-${unitId.value}`,
  () => `${unitsPath}/${unitId.value}/progress`,
)

// 分页追加保留 useHandleRes silent 链路（无 SEO 价值不必 SSR）
const { isLoadingMore, loadMore } = useUnitProgress()
const { fetchFavSegments, isSegmentFav, toggleSegment, togglingSegment } = useFavorites()

const unitData = computed(() => detailRes.value?.data?.unit ?? null)

// SEO：数据 SSR 期就绪，title/JSON-LD 直出真实单元信息（getter 兜底静态文案）
useSeoMeta({
  title: () => unitData.value?.title ?? '单元详情',
  description: () =>
    unitData.value?.description ??
    '浏览单元内全部学习片段，逐个完成盲听、学习、配音、跟读四阶段训练。',
})
useJsonLd(() =>
  learningResourceSchema({
    name: unitData.value?.title ?? '英语听说训练单元',
    description:
      unitData.value?.description ?? '包含盲听、学习、配音、影子跟读四阶段训练的英语学习单元。',
  }),
)

// 分页状态：首屏来自 useAsyncRes，loadMore 追加页存本地（跨单元导航时重置）
const extraSegments = ref<UnitProgressDetail['segments']>([])
const page = ref(1)
const extraHasMore = ref<boolean | null>(null)
const sentinelRef = ref<HTMLElement | null>(null)

const segments = computed(() => [
  ...(detailRes.value?.data?.segments ?? []),
  ...extraSegments.value,
])
const hasMore = computed(
  () => extraHasMore.value ?? detailRes.value?.data?.pagination.hasMore ?? false,
)

// 错误归一：网络/超时（error ref）与业务失败（code!==200，如 404）统一页内展示
const error = computed(() => {
  if (fetchError.value) return '加载失败，请检查网络'
  const payload = detailRes.value
  if (payload && payload.code !== 200) return payload.message || '加载失败'
  return null
})

const isLoading = computed(() => pending.value && !detailRes.value)

let scrollObserver: IntersectionObserver | null = null

// 跨单元导航（组件复用不重挂）：重置本地分页状态，响应式 key 自动重取首屏
watch(unitId, () => {
  extraSegments.value = []
  page.value = 1
  extraHasMore.value = null
})

async function retry() {
  extraSegments.value = []
  page.value = 1
  extraHasMore.value = null
  await refresh()
}

async function loadMoreSegments() {
  if (!hasMore.value || isLoadingMore.value) return
  const res = await loadMore(unitId.value, page.value + 1)
  if (res?.code === 200 && res.data) {
    extraSegments.value.push(...res.data.segments)
    page.value++
    extraHasMore.value = res.data.pagination.hasMore
  }
}

onMounted(() => {
  // 收藏是登录态数据：游客不发（避免 401 → resolveCode 弹 /login）
  if (userStore.isLogin) fetchFavSegments()

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

// 哨兵补绑：客户端导航进入时首帧处于 loading 分支，sentinel 尚未渲染，
// onMounted 的一次性 observe 永不生效（刷新走 SSR 直出才正常）。watch 覆盖
// loading→content、error→retry 恢复、跨单元导航分支重建三条路径；重复 observe 幂等无害。
watch(sentinelRef, (el, prev) => {
  if (prev) scrollObserver?.unobserve(prev)
  if (el) scrollObserver?.observe(el)
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

/** 最高分 chip 展示：整数省略小数位，其余保留 1 位 */
function formatScore(score: number) {
  return Number.isInteger(score) ? String(score) : score.toFixed(1)
}

function goLeaderboard(segId: number) {
  navigateTo(`/learn/unit/${unitId.value}/segment/${segId}/leaderboard`)
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
      <button class="retry-btn" @click="retry">重试</button>
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
              <template v-for="(item, idx) in getSegmentPhases(segment)" :key="item.phase">
                <div v-if="idx > 0" class="phase-line" :class="{ 'phase-line--done': item.done }" />
                <div
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
              </template>
            </div>
          </NuxtLink>

          <!-- 底部操作行：最高分 chips + 排行榜入口（在 NuxtLink 外，避免嵌套跳转） -->
          <div class="segment-card__footer">
            <div class="segment-card__scores">
              <span v-if="segment.progress.phase3_score !== null" class="score-chip">
                配音 {{ formatScore(segment.progress.phase3_score) }} 分
              </span>
              <span v-if="segment.progress.phase4_score !== null" class="score-chip">
                跟读 {{ formatScore(segment.progress.phase4_score) }} 分
              </span>
            </div>
            <button class="segment-lb-btn" @click="goLeaderboard(segment.id)">
              <svg viewBox="0 0 24 24" fill="currentColor">
                <path
                  d="M6 2h12v2h4v3a5 5 0 0 1-5 5h-.35A7 7 0 0 1 13 15.6V18h3a1 1 0 0 1 1 1v3H7v-3a1 1 0 0 1 1-1h3v-2.4A7 7 0 0 1 7.35 12H7a5 5 0 0 1-5-5V4h4V2zm0 4H4v1a3 3 0 0 0 2 2.83V6zm14 0h-2v3.83A3 3 0 0 0 20 7V6z"
                />
              </svg>
              排行榜
            </button>
          </div>

          <button
            v-if="userStore.isLogin"
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
  transition:
    transform 0.2s,
    box-shadow 0.2s;
  /* 离屏卡片跳过渲染/布局（渐进增强，旧 Safari 不支持时回退现状）；
     intrinsic-size 估高避免滚动条跳动 */
  content-visibility: auto;
  contain-intrinsic-size: auto 210px;
}

/* PC hover 反馈（仅 hover 能力设备，避免移动端点击残留悬浮态） */
@media (hover: hover) {
  .segment-card:hover {
    transform: translateY(-2px);
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.1);
  }
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

/* 自己的材料：淡背景高亮 + 「我的」角标（color-mix 随主题变量自适应深浅色） */
.segment-card--mine {
  background: color-mix(in srgb, var(--primary) 6%, var(--card));
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
  top: 12px;
  right: 12px;
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
  align-items: flex-start;
  gap: 10px;
  padding: 0 8px;
}

/* 阶段间连接线：对齐圆点中心（28px 图标的一半），右侧阶段完成则着 success 色 */
.phase-line {
  flex: 0 1 28px;
  height: 2px;
  margin-top: 13px;
  border-radius: 1px;
  background: var(--border-ll);
  transition: background 0.3s;
}

.phase-line--done {
  background: var(--success);
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

/* ===== 卡片底部操作行：最高分 chips + 排行榜入口 ===== */
.segment-card__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px solid var(--border-ll);
}

.segment-card__scores {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  min-height: 22px;
}

.score-chip {
  font-size: 11px;
  line-height: 1;
  padding: 5px 8px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--success) 12%, var(--card));
  color: var(--success);
  font-weight: 500;
}

.segment-lb-btn {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 5px 10px;
  background: transparent;
  border: 1px solid color-mix(in srgb, var(--primary) 40%, transparent);
  border-radius: 999px;
  font-size: 12px;
  color: var(--primary);
  cursor: pointer;
  transition: all 0.2s;
}

.segment-lb-btn svg {
  width: 13px;
  height: 13px;
}

@media (hover: hover) {
  .segment-lb-btn:hover {
    background: color-mix(in srgb, var(--primary) 10%, transparent);
  }
}

.segment-lb-btn:active {
  transform: scale(0.95);
}

/* 无限滚动哨兵 */
.sentinel {
  height: 1px;
}
</style>
