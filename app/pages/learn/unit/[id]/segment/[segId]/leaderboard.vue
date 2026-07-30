<script setup lang="ts">
import { segmentPath } from '~/api/paths'
import type { SegmentLeaderboard, SegmentLeaderboardBoard } from '#shared/types/leaderboard'

definePageMeta({
  title: '排行榜',
})

const route = useRoute()
const unitId = computed(() => Number(route.params.id))
const segId = computed(() => Number(route.params.segId))

// 只读首屏走 useAsyncRes（SSR 直出，失败页内降级不弹 toast）；两阶段数据一次下发，tab 切换零请求
const {
  data: lbRes,
  pending,
  error: fetchError,
  refresh,
} = useAsyncRes<SegmentLeaderboard | null>(
  () => `segment-leaderboard-${segId.value}`,
  () => `${segmentPath}/${segId.value}/leaderboard`,
)

const leaderboard = computed(() => lbRes.value?.data ?? null)

useSeoMeta({
  title: () =>
    leaderboard.value ? `${leaderboard.value.segment.title} - 排行榜` : '排行榜',
})

// 双 tab：配音（phase3）/ 跟读（phase4）
const activeTab = ref<'phase3' | 'phase4'>('phase3')
const activeBoard = computed<SegmentLeaderboardBoard | null>(() =>
  leaderboard.value ? leaderboard.value[activeTab.value] : null,
)

// 错误归一：网络/超时（error ref）与业务失败（code!==200，如 404）统一页内展示
const error = computed(() => {
  if (fetchError.value) return '加载失败，请检查网络'
  const payload = lbRes.value
  if (payload && payload.code !== 200) return payload.message || '加载失败'
  return null
})

const isLoading = computed(() => pending.value && !lbRes.value)

/** 分数展示：整数省略小数位，其余保留 1 位 */
function formatScore(score: number) {
  return Number.isInteger(score) ? String(score) : score.toFixed(1)
}

const router = useRouter()

/**
 * 「返回单元」：不能用 push 跳转——会把历史栈堆成「详情→排行榜→详情…」，
 * 导致左上角通用回退（router.back）又回到排行榜而非单元列表。
 * 来路恰是本单元详情页 → 历史回退（不新增记录）；
 * 直达/刷新/分享落地 → replace 跳转（排行榜记录被详情页替换，同样不留残留）。
 */
function backToUnit() {
  const unitPath = `/learn/unit/${unitId.value}`
  const back = router.options.history.state.back
  // 去掉 query/hash 后精确比对，避免 /learn/unit/1 误匹配 /learn/unit/12
  if (typeof back === 'string' && back.split(/[?#]/)[0] === unitPath) {
    router.back()
  } else {
    navigateTo(unitPath, { replace: true })
  }
}

function formatDate(s: string) {
  const d = new Date(s)
  if (isNaN(d.getTime())) return s
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
</script>

<template>
  <div class="leaderboard-page">
    <!-- Loading -->
    <div v-if="isLoading" class="loading-container">
      <DotPulse />
    </div>

    <!-- Error -->
    <div v-else-if="error" class="error-container">
      <div class="error-text">{{ error }}</div>
      <button class="retry-btn" @click="() => refresh()">重试</button>
    </div>

    <!-- Content -->
    <template v-else-if="leaderboard">
      <div class="lb-header">
        <h2 class="lb-header__title">{{ leaderboard.segment.title }}</h2>
        <p class="lb-header__desc">配音与跟读的全站最佳成绩榜（前 50 名）</p>
        <button class="lb-header__back" @click="backToUnit">返回单元</button>
      </div>

      <!-- 阶段 tab -->
      <div class="tabs">
        <button
          class="tab"
          :class="{ 'tab--active': activeTab === 'phase3' }"
          @click="activeTab = 'phase3'"
        >
          配音成绩
        </button>
        <button
          class="tab"
          :class="{ 'tab--active': activeTab === 'phase4' }"
          @click="activeTab = 'phase4'"
        >
          跟读成绩
        </button>
      </div>

      <template v-if="activeBoard">
        <!-- 我的名次 -->
        <div v-if="activeBoard.me" class="me-card">
          <div class="me-card__rank">第 {{ activeBoard.me.rank }} 名</div>
          <div class="me-card__info">
            <span class="me-card__label">我的最佳</span>
            <span class="me-card__score">{{ formatScore(activeBoard.me.bestScore) }} 分</span>
            <span class="me-card__time">{{ formatDate(activeBoard.me.achievedAt) }}</span>
          </div>
        </div>
        <div v-else class="me-card me-card--empty">
          <span>暂无成绩，完成一次{{ activeTab === 'phase3' ? '配音' : '跟读' }}即可上榜</span>
          <NuxtLink :to="`/learn/unit/${unitId}/segment/${segId}`" class="me-card__link">
            去挑战
          </NuxtLink>
        </div>

        <!-- 榜单 -->
        <div v-if="activeBoard.list.length" class="rank-list">
          <div
            v-for="entry in activeBoard.list"
            :key="entry.rank"
            class="rank-item"
            :class="{ 'rank-item--me': entry.isMe }"
          >
            <div class="rank-item__rank" :class="`rank-item__rank--${entry.rank}`">
              {{ entry.rank }}
            </div>
            <div class="rank-item__avatar">
              <img v-if="entry.avatarUrl" :src="entry.avatarUrl" alt="" />
              <span v-else>{{ entry.nickname.slice(0, 1) }}</span>
            </div>
            <div class="rank-item__main">
              <div class="rank-item__name">
                {{ entry.nickname }}<span v-if="entry.isMe" class="rank-item__me-badge">我</span>
              </div>
              <div class="rank-item__time">{{ formatDate(entry.achievedAt) }}</div>
            </div>
            <div class="rank-item__score">{{ formatScore(entry.bestScore) }}</div>
          </div>
        </div>
        <div v-else class="empty-state">
          该阶段还没有人上榜，抢占第一个席位吧
        </div>
      </template>
    </template>
  </div>
</template>

<style scoped>
.leaderboard-page {
  padding: 16px;
  min-height: 100%;
}

/* ===== 页头 ===== */
.lb-header {
  position: relative;
  margin-bottom: 16px;
}

.lb-header__title {
  font-size: 18px;
  font-weight: 600;
  color: var(--text-1);
  margin-bottom: 4px;
  padding-right: 72px;
}

.lb-header__desc {
  font-size: 13px;
  color: var(--text-3);
}

.lb-header__back {
  position: absolute;
  top: 2px;
  right: 0;
  padding: 0;
  background: none;
  border: none;
  font-size: 13px;
  color: var(--primary);
  cursor: pointer;
}

/* ===== tab（对齐 review 页子 tab 样式） ===== */
.tabs {
  display: flex;
  gap: 24px;
  margin-bottom: 16px;
  border-bottom: 1px solid var(--border-ll);
}

.tab {
  padding: 8px 4px;
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
  font-size: 15px;
  color: var(--text-3);
  cursor: pointer;
  transition: all 0.2s;
}

.tab--active {
  color: var(--primary);
  border-bottom-color: var(--primary);
  font-weight: 500;
}

/* ===== 我的名次卡 ===== */
.me-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  margin-bottom: 12px;
  background: color-mix(in srgb, var(--primary) 8%, var(--card));
  border: 1px solid color-mix(in srgb, var(--primary) 25%, transparent);
  border-radius: var(--r-lg);
}

.me-card__rank {
  font-size: 16px;
  font-weight: 700;
  color: var(--primary);
  flex-shrink: 0;
}

.me-card__info {
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex-wrap: wrap;
}

.me-card__label {
  font-size: 12px;
  color: var(--text-3);
}

.me-card__score {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-1);
}

.me-card__time {
  font-size: 12px;
  color: var(--text-3);
}

.me-card--empty {
  justify-content: space-between;
  font-size: 13px;
  color: var(--text-3);
}

.me-card__link {
  flex-shrink: 0;
  padding: 6px 16px;
  background: var(--primary);
  color: #fff;
  border-radius: var(--r);
  font-size: 13px;
  text-decoration: none;
}

/* ===== 榜单 ===== */
.rank-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.rank-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  background: var(--card);
  border-radius: var(--r-lg);
  box-shadow: var(--shadow);
}

.rank-item--me {
  background: color-mix(in srgb, var(--primary) 8%, var(--card));
  border: 1px solid color-mix(in srgb, var(--primary) 25%, transparent);
}

.rank-item__rank {
  width: 28px;
  flex-shrink: 0;
  text-align: center;
  font-size: 15px;
  font-weight: 700;
  color: var(--text-3);
}

/* 前三名奖牌配色 */
.rank-item__rank--1 {
  color: #f7b500;
}

.rank-item__rank--2 {
  color: #9aa4b2;
}

.rank-item__rank--3 {
  color: #c9856b;
}

.rank-item__avatar {
  width: 36px;
  height: 36px;
  flex-shrink: 0;
  border-radius: 50%;
  overflow: hidden;
  background: var(--border-ll);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-3);
}

.rank-item__avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.rank-item__main {
  flex: 1;
  min-width: 0;
}

.rank-item__name {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  font-weight: 500;
  color: var(--text-1);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rank-item__me-badge {
  flex-shrink: 0;
  font-size: 10px;
  line-height: 1;
  padding: 2px 5px;
  border-radius: 4px;
  background: var(--primary);
  color: #fff;
}

.rank-item__time {
  font-size: 11px;
  color: var(--text-3);
  margin-top: 2px;
}

.rank-item__score {
  flex-shrink: 0;
  font-size: 17px;
  font-weight: 700;
  color: var(--primary);
}

/* ===== 公共状态 ===== */
.loading-container {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 60vh;
}

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

.empty-state {
  text-align: center;
  padding: 32px 24px;
  font-size: 14px;
  color: var(--text-3);
}
</style>
