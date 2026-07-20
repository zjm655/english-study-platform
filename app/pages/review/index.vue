<script setup lang="ts">
import { useAudioPlayer } from '~/composables/media/useAudioPlayer'
import { useVocabCardState } from '~/composables/review/useVocabCardState'
import { useMaterialNavState } from '~/composables/review/useMaterialNavState'
import { useStudyTimer } from '~/composables/user/useStudyTimer'
import { getReviewVocab, getReviewMaterial } from '~/api/review'
import type { ReviewVocabItem, ReviewMaterialItem } from '#shared/types/review'
import type { Question } from '~~/shared/types/unit'

definePageMeta({
  title: '复习',
})

const { load, play, stop } = useAudioPlayer()

// 自动上报学习时长
useStudyTimer()

// 顶部子 tab
const activeTab = ref<'vocab' | 'material'>('vocab')

// ===== 单词复习 =====
const vocabList = ref<ReviewVocabItem[]>([])
const vocabLoading = ref(false)
const vocabError = ref<string | null>(null)
const vocabLoaded = ref(false)

// 单词卡片状态机：currentIndex/isFlipped/isCompleted + toggleFlip/markKnown/markUnknown/next/reset
const {
  currentIndex: vocabCurrentIndex,
  isFlipped,
  isCompleted: vocabCompleted,
  toggleFlip,
  markKnown,
  markUnknown,
  next: nextVocab,
  reset: restartVocab,
} = useVocabCardState(() => vocabList.value)

async function loadVocab() {
  vocabLoading.value = true
  vocabError.value = null
  const res = await getReviewVocab(10)
  vocabLoading.value = false
  vocabLoaded.value = true
  if (res?.code === 200 && res.data) {
    vocabList.value = res.data
  } else {
    vocabError.value = res?.message || '加载失败'
  }
}

async function playVocabAudio(url: string | null) {
  if (!url) return
  await load(url)
  play()
}

// ===== 材料复习 =====
const materialList = ref<ReviewMaterialItem[]>([])
const materialLoading = ref(false)
const materialError = ref<string | null>(null)
const materialLoaded = ref(false)
const selectedOption = ref<string | null>(null)
const showMaterialResult = ref(false)

async function loadMaterial() {
  if (materialLoaded.value) return
  materialLoading.value = true
  materialError.value = null
  const res = await getReviewMaterial(5)
  materialLoading.value = false
  materialLoaded.value = true
  if (res?.code === 200 && res.data) {
    materialList.value = res.data
  } else {
    materialError.value = res?.message || '加载失败'
  }
}

function switchToMaterial() {
  activeTab.value = 'material'
  loadMaterial()
}

// questions 是 JSON 字符串，try-catch 降级为空数组
function parseQuestions(raw: string | null): Question[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

// 材料导航状态机：currentIndex/isCompleted/current + next/reset
const {
  currentIndex: materialCurrentIndex,
  isCompleted: materialCompleted,
  current: currentMaterial,
  next: nextMaterialNav,
  reset: resetMaterialNav,
} = useMaterialNavState(() => materialList.value)

const currentFirstQuestion = computed<Question | null>(() => {
  if (!currentMaterial.value) return null
  const qs = parseQuestions(currentMaterial.value.questions)
  return qs[0] || null
})

async function playMaterialAudio(url: string | null) {
  if (!url) return
  await load(url)
  play()
}

function selectOption(option: string) {
  if (showMaterialResult.value) return
  selectedOption.value = option
  showMaterialResult.value = true
}

function nextMaterial() {
  // 切换材料时停止当前音频
  stop()
  selectedOption.value = null
  showMaterialResult.value = false
  nextMaterialNav()
}

function restartMaterial() {
  resetMaterialNav()
  selectedOption.value = null
  showMaterialResult.value = false
}

onMounted(() => {
  loadVocab()
})
</script>

<template>
  <div class="review-page">
    <!-- 顶部子 tab -->
    <div class="tabs">
      <button
        class="tab"
        :class="{ 'tab--active': activeTab === 'vocab' }"
        @click="activeTab = 'vocab'"
      >
        单词
      </button>
      <button
        class="tab"
        :class="{ 'tab--active': activeTab === 'material' }"
        @click="switchToMaterial"
      >
        材料
      </button>
    </div>

    <!-- 单词复习 -->
    <div v-if="activeTab === 'vocab'">
      <!-- Loading -->
      <div v-if="vocabLoading" class="loading-container">
        <DotPulse />
      </div>

      <!-- Error -->
      <div v-else-if="vocabError" class="error-container">
        <div class="error-text">{{ vocabError }}</div>
        <button class="retry-btn" @click="loadVocab">重试</button>
      </div>

      <!-- Empty -->
      <div v-else-if="vocabLoaded && !vocabList.length" class="empty-state">
        <p class="empty-text">先去学习一些材料吧</p>
        <NuxtLink to="/learn" class="empty-link">去学习</NuxtLink>
      </div>

      <!-- 完成态 -->
      <div v-else-if="vocabCompleted" class="complete-state">
        <p class="complete-text">已复习 {{ vocabList.length }} 个单词</p>
        <button class="restart-btn" @click="restartVocab">再来一轮</button>
      </div>

      <!-- 卡片内容 -->
      <div v-else-if="vocabList.length" class="vocab-content">
        <div class="progress">{{ vocabCurrentIndex + 1 }} / {{ vocabList.length }}</div>

        <div class="flip-card" @click="toggleFlip">
          <!-- 正面 -->
          <div v-if="!isFlipped" class="card-face card-front">
            <div class="vocab-word">{{ vocabList[vocabCurrentIndex].word }}</div>
            <div v-if="vocabList[vocabCurrentIndex].phonetic" class="vocab-phonetic">
              {{ vocabList[vocabCurrentIndex].phonetic }}
            </div>
            <button
              v-if="vocabList[vocabCurrentIndex].audioUrl"
              class="audio-btn"
              @click.stop="playVocabAudio(vocabList[vocabCurrentIndex].audioUrl)"
            >
              <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z" />
              </svg>
            </button>
          </div>

          <!-- 背面 -->
          <div v-else class="card-face card-back">
            <div class="vocab-word">{{ vocabList[vocabCurrentIndex].word }}</div>
            <div class="vocab-meaning">{{ vocabList[vocabCurrentIndex].meaning }}</div>
            <div v-if="vocabList[vocabCurrentIndex].forms" class="vocab-forms">
              <span class="vocab-label">变形：</span>
              <span>{{ vocabList[vocabCurrentIndex].forms }}</span>
            </div>
            <div v-if="vocabList[vocabCurrentIndex].exampleSentence" class="vocab-example">
              {{ vocabList[vocabCurrentIndex].exampleSentence }}
            </div>
            <div v-if="vocabList[vocabCurrentIndex].exampleTranslation" class="vocab-example-trans">
              {{ vocabList[vocabCurrentIndex].exampleTranslation }}
            </div>
          </div>
        </div>

        <!-- 底部操作区 -->
        <div class="vocab-actions">
          <button class="action-btn action-btn--success" @click="markKnown">认识</button>
          <button class="action-btn action-btn--warning" @click="markUnknown">不认识</button>
          <button class="action-btn action-btn--primary" @click="nextVocab">→</button>
        </div>
      </div>
    </div>

    <!-- 材料复习 -->
    <div v-else>
      <!-- Loading -->
      <div v-if="materialLoading" class="loading-container">
        <DotPulse />
      </div>

      <!-- Error -->
      <div v-else-if="materialError" class="error-container">
        <div class="error-text">{{ materialError }}</div>
        <button class="retry-btn" @click="loadMaterial">重试</button>
      </div>

      <!-- Empty -->
      <div v-else-if="materialLoaded && !materialList.length" class="empty-state">
        <p class="empty-text">先去学习一些材料吧</p>
        <NuxtLink to="/learn" class="empty-link">去学习</NuxtLink>
      </div>

      <!-- 完成态 -->
      <div v-else-if="materialCompleted" class="complete-state">
        <p class="complete-text">复习完成</p>
        <button class="restart-btn" @click="restartMaterial">再来一轮</button>
      </div>

      <!-- 材料内容 -->
      <div v-else-if="currentMaterial" class="material-content">
        <div class="progress">{{ materialCurrentIndex + 1 }} / {{ materialList.length }}</div>

        <div class="material-card">
          <div class="material-title">{{ currentMaterial.title }}</div>

          <button
            v-if="currentMaterial.audioUrl"
            class="material-play-btn"
            @click="playMaterialAudio(currentMaterial.audioUrl)"
          >
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5v14l11-7z" />
            </svg>
            播放音频
          </button>

          <!-- 第一题 -->
          <div v-if="currentFirstQuestion" class="material-question">
            <div class="question-text">{{ currentFirstQuestion.question }}</div>
            <div class="options">
              <button
                v-for="option in currentFirstQuestion.options"
                :key="option"
                class="option-btn"
                :class="{
                  'option-btn--correct': showMaterialResult && option === currentFirstQuestion.answer,
                  'option-btn--wrong': showMaterialResult && selectedOption === option && option !== currentFirstQuestion.answer,
                }"
                :disabled="showMaterialResult"
                @click="selectOption(option)"
              >
                {{ option }}
              </button>
            </div>
          </div>

          <!-- 下一段：无题目时立即显示，有题目时答完显示 -->
          <button
            v-if="!currentFirstQuestion || showMaterialResult"
            class="next-material-btn"
            @click="nextMaterial"
          >
            下一段
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.review-page {
  padding: 16px;
  min-height: 100%;
}

/* ===== 顶部子 tab ===== */
.tabs {
  display: flex;
  gap: 24px;
  margin-bottom: 20px;
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
}

.retry-btn:active {
  opacity: 0.85;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 40vh;
  gap: 16px;
}

.empty-text {
  font-size: 14px;
  color: var(--text-3);
}

.empty-link {
  padding: 10px 28px;
  background: var(--primary);
  color: #fff;
  border-radius: var(--r);
  font-size: 14px;
  text-decoration: none;
}

.empty-link:active {
  opacity: 0.85;
}

/* ===== 完成态 ===== */
.complete-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 40vh;
  gap: 20px;
}

.complete-text {
  font-size: 16px;
  font-weight: 500;
  color: var(--text-1);
}

.restart-btn {
  padding: 12px 32px;
  background: var(--primary);
  color: #fff;
  border: none;
  border-radius: var(--r);
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
}

.restart-btn:active {
  opacity: 0.85;
}

/* ===== 单词复习 ===== */
.vocab-content {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.progress {
  text-align: center;
  font-size: 13px;
  color: var(--text-3);
}

.flip-card {
  background: var(--card);
  border-radius: var(--r-lg);
  box-shadow: var(--shadow);
  padding: 32px 20px;
  min-height: 280px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: transform 0.2s;
}

.flip-card:active {
  transform: scale(0.98);
}

.card-face {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  width: 100%;
  text-align: center;
}

.vocab-word {
  font-size: 28px;
  font-weight: 600;
  color: var(--text-1);
}

.vocab-phonetic {
  font-size: 15px;
  color: var(--text-2);
  font-family: 'Times New Roman', serif;
}

.audio-btn {
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--primary-light);
  border: none;
  border-radius: 50%;
  color: var(--primary);
  cursor: pointer;
  margin-top: 8px;
  transition: all 0.2s;
}

.audio-btn:active {
  background: var(--primary);
  color: #fff;
}

.audio-btn svg {
  width: 20px;
  height: 20px;
}

.vocab-meaning {
  font-size: 18px;
  color: var(--text-1);
  line-height: 1.5;
}

.vocab-forms {
  font-size: 13px;
  color: var(--text-2);
}

.vocab-label {
  color: var(--text-3);
}

.vocab-example {
  font-size: 14px;
  color: var(--text-1);
  font-style: italic;
  margin-top: 4px;
  line-height: 1.5;
}

.vocab-example-trans {
  font-size: 13px;
  color: var(--text-2);
}

/* 底部操作区 */
.vocab-actions {
  display: flex;
  gap: 10px;
}

.action-btn {
  flex: 1;
  padding: 12px;
  border: none;
  border-radius: var(--r);
  font-size: 14px;
  font-weight: 500;
  color: #fff;
  cursor: pointer;
  transition: opacity 0.2s;
}

.action-btn:active {
  opacity: 0.85;
}

.action-btn--success {
  background: var(--success);
}

.action-btn--warning {
  background: var(--warning);
}

.action-btn--primary {
  background: var(--primary);
}

/* ===== 材料复习 ===== */
.material-content {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.material-card {
  background: var(--card);
  border-radius: var(--r-lg);
  box-shadow: var(--shadow);
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.material-title {
  font-size: 18px;
  font-weight: 600;
  color: var(--text-1);
}

.material-play-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 10px 16px;
  background: var(--primary-light);
  border: 1px solid var(--border-ll);
  border-radius: var(--r);
  color: var(--primary);
  font-size: 14px;
  cursor: pointer;
  align-self: flex-start;
  transition: all 0.2s;
}

.material-play-btn:active {
  background: var(--primary);
  color: #fff;
}

.material-play-btn svg {
  width: 16px;
  height: 16px;
}

.material-question {
  padding-top: 12px;
  border-top: 1px solid var(--border-ll);
}

.question-text {
  font-size: 15px;
  font-weight: 500;
  color: var(--text-1);
  margin-bottom: 14px;
  line-height: 1.5;
}

.options {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.option-btn {
  width: 100%;
  padding: 12px 14px;
  background: var(--card);
  border: 1px solid var(--border-ll);
  border-radius: var(--r);
  font-size: 14px;
  color: var(--text-1);
  text-align: left;
  cursor: pointer;
  transition: all 0.2s;
}

.option-btn:hover:not(:disabled) {
  border-color: var(--primary);
}

.option-btn--correct {
  border-color: var(--success);
  background: var(--success-light);
  color: var(--success);
}

.option-btn--wrong {
  border-color: var(--danger);
  background: var(--danger-light);
  color: var(--danger);
}

.option-btn:disabled {
  cursor: not-allowed;
}

.next-material-btn {
  padding: 12px;
  background: var(--primary);
  border: none;
  border-radius: var(--r);
  color: #fff;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
}

.next-material-btn:active {
  opacity: 0.9;
}
</style>
