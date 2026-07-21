<script setup lang="ts">
import type { Recording, WordScore } from '#shared/types/recording'
import { diffRecognized } from '~/utils/wordDiff'

const props = defineProps<{
  /** 录音记录（含评测结果） */
  recording: Recording
  /** 参考原文，用于识别文本对齐标红 */
  referenceText: string
}>()

// 折叠状态
const recognizedExpanded = ref(true)
const wordScoresExpanded = ref(true)

// 逐词评分颜色类
function getWordStatusClass(word: WordScore): string {
  switch (word.status) {
    case 'correct':
      return 'word--correct'
    case 'minor':
      return 'word--minor'
    case 'wrong':
      return 'word--wrong'
    case 'missing':
      return 'word--missing'
    default:
      return ''
  }
}

// 识别文本 vs 原文的词级对齐（降级：为空时不渲染标红区）
const recognizedDiff = computed(() => {
  const text = props.recording.recognizedText
  if (!text) return []
  try {
    return diffRecognized(text, props.referenceText)
  } catch {
    return []
  }
})
</script>

<template>
  <div class="analysis-result">
    <div class="score-section">
      <div class="score-number">{{ recording.score }}</div>
      <div class="score-label">综合评分</div>
      <div class="score-bar">
        <div class="score-bar__fill" :style="{ width: `${recording.score}%` }"></div>
      </div>
    </div>

    <div class="feedback-section">
      <div class="feedback-title">AI 评价</div>
      <p class="feedback-text">{{ recording.feedback || '暂无评价' }}</p>
    </div>

    <!-- 识别文本（ASR 真实转写，与原文不一致处标红） -->
    <div class="recognized-section">
      <button class="section-header" @click="recognizedExpanded = !recognizedExpanded">
        <span class="section-header__title">识别文本</span>
        <svg
          class="section-header__arrow"
          :class="{ 'section-header__arrow--expanded': recognizedExpanded }"
          viewBox="0 0 24 24"
          fill="currentColor"
        >
          <path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z" />
        </svg>
      </button>
      <div v-show="recognizedExpanded" class="section-body">
        <p v-if="recording.recognizedText === null" class="recognized-placeholder">识别中…</p>
        <p v-else-if="!recording.recognizedText" class="recognized-placeholder">未识别到文本</p>
        <p v-else-if="recognizedDiff.length === 0" class="recognized-text">
          {{ recording.recognizedText }}
        </p>
        <p v-else class="recognized-text">
          <template v-for="(tok, idx) in recognizedDiff" :key="idx"
            ><span class="rec-word" :class="{ 'rec-word--mismatch': !tok.match }">{{
              tok.word
            }}</span
            >{{ ' ' }}</template
          >
        </p>
      </div>
    </div>

    <div class="word-scores-section">
      <button class="section-header" @click="wordScoresExpanded = !wordScoresExpanded">
        <span class="section-header__title">逐词评分</span>
        <svg
          class="section-header__arrow"
          :class="{ 'section-header__arrow--expanded': wordScoresExpanded }"
          viewBox="0 0 24 24"
          fill="currentColor"
        >
          <path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z" />
        </svg>
      </button>
      <div v-show="wordScoresExpanded" class="section-body">
        <p v-if="!recording.wordScores?.length" class="word-scores-placeholder">暂无逐词评分数据</p>
        <div v-else class="word-scores">
          <span
            v-for="(word, idx) in recording.wordScores"
            :key="idx"
            class="word-score"
            :class="getWordStatusClass(word)"
            :title="`${word.word}: ${word.score} 分`"
          >
            {{ word.word }}
          </span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.analysis-result {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.score-section {
  text-align: center;
}

.score-number {
  font-size: 48px;
  font-weight: 700;
  color: var(--primary);
  line-height: 1;
  margin-bottom: 4px;
}

.score-label {
  font-size: 13px;
  color: var(--text-3);
  margin-bottom: 12px;
}

.score-bar {
  height: 6px;
  background: var(--border-ll);
  border-radius: 3px;
  overflow: hidden;
}

.score-bar__fill {
  height: 100%;
  background: linear-gradient(90deg, var(--primary), var(--success));
  border-radius: 3px;
  transition: width 0.5s ease;
}

.feedback-section {
  padding-top: 12px;
  border-top: 1px solid var(--border-ll);
}

.feedback-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-1);
  margin-bottom: 8px;
}

.feedback-text {
  font-size: 13px;
  color: var(--text-2);
  line-height: 1.6;
  margin: 0;
}

/* ===== 识别文本 ===== */
.recognized-section {
  padding-top: 12px;
  border-top: 1px solid var(--border-ll);
}

.recognized-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-1);
  margin-bottom: 8px;
}

.recognized-text {
  font-size: 13px;
  color: var(--text-2);
  line-height: 1.7;
  margin: 0;
  overflow-wrap: break-word;
  word-break: break-word;
}

.recognized-placeholder {
  font-size: 13px;
  color: var(--text-3);
  font-style: italic;
  margin: 0;
}

.rec-word--mismatch {
  color: var(--danger);
  background: rgba(245, 108, 108, 0.1);
  border-radius: 4px;
  padding: 0 3px;
}

/* ===== 逐词评分 ===== */
.word-scores-section {
  padding-top: 12px;
  border-top: 1px solid var(--border-ll);
}

.word-scores-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-1);
  margin-bottom: 10px;
}

.word-scores {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 8px;
}

.word-score {
  font-size: 13px;
  padding: 2px 6px;
  border-radius: 4px;
  cursor: default;
  transition: opacity 0.2s;
}

.word--correct {
  color: var(--success);
  background: rgba(103, 194, 58, 0.1);
}

.word--minor {
  color: var(--warning);
  background: var(--warning-light);
}

.word--wrong {
  color: var(--danger);
  background: rgba(245, 108, 108, 0.1);
}

.word--missing {
  color: var(--text-3);
  background: var(--bg);
  text-decoration: line-through;
}

/* ===== 可折叠区域通用样式 ===== */
.section-header {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: none;
  border: none;
  padding: 0;
  margin: 0;
  cursor: pointer;
  color: inherit;
}

.section-header__title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-1);
}

.section-header__arrow {
  width: 18px;
  height: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: transform 0.2s;
  color: var(--text-3);
}

.section-header__arrow--expanded {
  transform: rotate(180deg);
}

.section-body {
  margin-top: 8px;
}

.word-scores-placeholder {
  font-size: 13px;
  color: var(--text-3);
  font-style: italic;
  margin: 0;
}
</style>
