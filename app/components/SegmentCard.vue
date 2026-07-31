<script setup lang="ts">
import { Check } from '@element-plus/icons-vue'
import type { UnitProgressDetail } from '#shared/types/unit'

type UnitSegment = UnitProgressDetail['segments'][number]

interface Props {
  segment: UnitSegment
  unitId: number
  /** 是否已收藏（由父页面注入，本组件不调用 useFavorites） */
  favActive: boolean
  /** 收藏按钮禁用（toggle 进行中） */
  favDisabled?: boolean
  /** 游客态（淡化收藏按钮） */
  guest?: boolean
  /** 是否显示底部操作行（排行榜/我的单词），默认 true */
  showExtras?: boolean
}

withDefaults(defineProps<Props>(), {
  favDisabled: false,
  guest: false,
  showExtras: true,
})

const emit = defineEmits<{
  (e: 'toggle-fav' | 'go-leaderboard' | 'open-words'): void
}>()

function getSegmentPhases(segment: UnitSegment) {
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
</script>

<template>
  <div class="segment-card" :class="{ 'segment-card--mine': segment.isMine }">
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

    <!-- 底部操作行：最高分 chips + 排行榜/我的单词入口（在 NuxtLink 外，避免嵌套跳转） -->
    <div v-if="showExtras" class="segment-card__footer">
      <div class="segment-card__scores">
        <span v-if="segment.progress.phase3_score !== null" class="score-chip">
          配音 {{ formatScore(segment.progress.phase3_score) }} 分
        </span>
        <span v-if="segment.progress.phase4_score !== null" class="score-chip">
          跟读 {{ formatScore(segment.progress.phase4_score) }} 分
        </span>
      </div>
      <div class="segment-card__actions">
        <button class="segment-lb-btn" @click="emit('go-leaderboard')">
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path
              d="M6 2h12v2h4v3a5 5 0 0 1-5 5h-.35A7 7 0 0 1 13 15.6V18h3a1 1 0 0 1 1 1v3H7v-3a1 1 0 0 1 1-1h3v-2.4A7 7 0 0 1 7.35 12H7a5 5 0 0 1-5-5V4h4V2zm0 4H4v1a3 3 0 0 0 2 2.83V6zm14 0h-2v3.83A3 3 0 0 0 20 7V6z"
            />
          </svg>
          排行榜
        </button>
        <button class="segment-words-btn" @click="emit('open-words')">
          <svg viewBox="0 0 24 24" fill="currentColor" style="width: 18px">
            <path
              d="M4 4h6a2 2 0 0 1 2 2v14a2 2 0 0 0-2-2H4V4zm16 0h-6a2 2 0 0 0-2 2v14a2 2 0 0 1 2-2h6V4z"
            />
          </svg>
          单词本
        </button>
      </div>
    </div>

    <button
      class="segment-fav-btn"
      :class="{
        'segment-fav-btn--active': favActive,
        'segment-fav-btn--guest': guest,
      }"
      :disabled="favDisabled"
      @click="emit('toggle-fav')"
    >
      <svg viewBox="0 0 24 24" fill="currentColor">
        <path
          d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"
        />
      </svg>
    </button>
  </div>
</template>

<style scoped>
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
  transform: scale(1.1);
}

.segment-fav-btn:active:not(:disabled) {
  color: var(--warning);
  transform: scale(0.95);
}

.segment-fav-btn--active {
  color: var(--warning);
}

.segment-fav-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* 游客可见但淡化，点击时温和提示登录 */
.segment-fav-btn--guest {
  opacity: 0.6;
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

/* ===== 卡片底部操作行：最高分 chips + 排行榜/我的单词入口 ===== */
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

.segment-card__actions {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  width: 50%;
  justify-content: space-between;
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
  margin-right: 8px;
}

.segment-words-btn {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 3px;
  white-space: nowrap;
  padding: 5px 10px;
  background: transparent;
  border: 1px solid color-mix(in srgb, var(--primary) 40%, transparent);
  border-radius: 999px;
  font-size: 12px;
  color: var(--primary);
  cursor: pointer;
  transition: all 0.2s;
  margin-right: 8px;
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
</style>
