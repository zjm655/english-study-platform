<script setup lang="ts">
import { useUnitProgress } from '~/composables/unit'
import { useFavorites } from '~/composables/useFavorites'
import { useGuestStudyTimer } from '~/composables/user/useGuestStudyTimer'
import { useUserStore } from '~/store/useUserStore'
import SegmentCard from '~/components/SegmentCard.vue'
import type { UnitProgressDetail } from '#shared/types/unit'
import type { ResPayload } from '#shared/types/request'

definePageMeta({
  title: '单元详情',
})

const route = useRoute()
const unitId = computed(() => Number(route.params.id))
const userStore = useUserStore()

// 游客学习时长计时（仅游客生效，登录用户内部短路）
useGuestStudyTimer()

// 首屏数据：走 useHandleRes 链路（客户端加载，骨架屏兜底）
const {
  isLoading: detailLoading,
  execute: fetchUnitProgress,
  isLoadingMore,
  loadMore,
} = useUnitProgress()
const { fetchFavSegments, isSegmentFav, toggleSegment, togglingSegment } = useFavorites()

// 收藏材料过滤开关：favOnly 时列表仅显示已收藏片段
const favOnly = ref(false)
const displayedSegments = computed(() =>
  favOnly.value ? segments.value.filter((s) => isSegmentFav(s.id)) : segments.value,
)

const detailRes = ref<ResPayload<UnitProgressDetail> | null>(null)
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

// 分页状态：首屏来自 useHandleRes，loadMore 追加页存本地（跨单元导航时重置）
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

// 错误归一：业务失败（code!==200，如 404）页内展示；网络异常由 useHandleRes toast 兜底
const error = computed(() => {
  const payload = detailRes.value
  if (payload && payload.code !== 200) return payload.message || '加载失败'
  return null
})

const isLoading = computed(() => (detailLoading.value || isLoadingMore.value) && !detailRes.value)

let scrollObserver: IntersectionObserver | null = null

// 跨单元导航（组件复用不重挂）：重置本地分页状态，重新拉取首屏
watch(unitId, () => {
  extraSegments.value = []
  page.value = 1
  extraHasMore.value = null
  loadData()
})

async function loadData() {
  detailRes.value = null
  const res = await fetchUnitProgress(unitId.value)
  if (res) {
    detailRes.value = res
  }
}

async function retry() {
  extraSegments.value = []
  page.value = 1
  extraHasMore.value = null
  await loadData()
}

async function loadMoreSegments() {
  if (!hasMore.value || isLoadingMore.value) return
  // 收藏过滤态下不追加分页（列表仅展示已加载的收藏片段）
  if (favOnly.value) return
  const res = await loadMore(unitId.value, page.value + 1)
  if (res?.code === 200 && res.data) {
    extraSegments.value.push(...res.data.segments)
    page.value++
    extraHasMore.value = res.data.pagination.hasMore
  }
}

onMounted(() => {
  // 首屏加载单元进度
  loadData()
  // 收藏列表（登录用户 + 游客均支持）
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

function goLeaderboard(segId: number) {
  navigateTo(`/learn/unit/${unitId.value}/segment/${segId}/leaderboard`)
}

/** 收藏片段 */
function handleToggleSegment(segId: number) {
  toggleSegment(segId)
}

/** 跳转「我的单词」页 */
function goFavWords(segment: UnitProgressDetail['segments'][number]) {
  navigateTo(`/learn/unit/${unitId.value}/segment/${segment.id}/words`)
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
    <div v-else-if="!displayedSegments.length" class="empty-state">
      {{ favOnly ? '暂无收藏材料' : '暂无片段数据' }}
    </div>

    <!-- Content -->
    <template v-else>
      <div class="unit-header">
        <h2 class="unit-header__title">{{ unitData?.title }}</h2>
        <p v-if="unitData?.description" class="unit-header__desc">{{ unitData.description }}</p>
        <button
          class="unit-fav-btn"
          :class="{ 'unit-fav-btn--active': favOnly }"
          @click="favOnly = !favOnly"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" style="width: 16px">
            <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" />
          </svg>
          {{ favOnly ? '全部材料' : '收藏材料' }}
        </button>
      </div>

      <div class="segment-list">
        <SegmentCard
          v-for="segment in displayedSegments"
          :key="segment.id"
          :segment="segment"
          :unit-id="unitId"
          :fav-active="isSegmentFav(segment.id)"
          :fav-disabled="togglingSegment === segment.id"
          :guest="!userStore.isLogin"
          @toggle-fav="handleToggleSegment(segment.id)"
          @go-leaderboard="goLeaderboard(segment.id)"
          @open-words="goFavWords(segment)"
        />

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
  position: relative;
  padding-right: 96px;
}

.unit-fav-btn {
  position: absolute;
  right: 0;
  top: 0;
  display: flex;
  white-space: nowrap;
  align-items: center;
  gap: 4px;
  padding: 6px 12px;
  background: transparent;
  border: 1px solid color-mix(in srgb, var(--primary) 40%, transparent);
  border-radius: 999px;
  font-size: 12px;
  color: var(--primary);
  cursor: pointer;
  transition: all 0.2s;
}

.unit-fav-btn:hover {
  /* background: color-mix(in srgb, var(--primary) 10%, transparent); */
  border-color: var(--primary);
}

/* 过滤开关激活态：实心高亮 */
.unit-fav-btn--active {
  background: var(--primary);
  border-color: var(--primary);
  color: #fff;
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

/* 列表底部加载提示 */
.list-footer {
  text-align: center;
  padding: 12px;
  font-size: 12px;
  color: var(--text-3);
}

/* 无限滚动哨兵 */
.sentinel {
  height: 1px;
}
</style>
