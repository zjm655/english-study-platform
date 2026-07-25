<script setup lang="ts">
import { useAudioPlayer } from '~/composables/media/useAudioPlayer'
import { useAudioStore } from '~/store/useAudioStore'
import { useVocabCardState } from '~/composables/review/useVocabCardState'
import { useMaterialNavState } from '~/composables/review/useMaterialNavState'
import { useStudyTimer } from '~/composables/user/useStudyTimer'
import { getReviewVocab, getReviewMaterial } from '~/api/review'
import type { ReviewVocabItem, ReviewMaterialItem } from '#shared/types/review'
import type { Question } from '~~/shared/types/unit'

definePageMeta({
  title: '复习',
})

useSeoMeta({
  title: '复习',
  description: '翻转单词卡片巩固重点词汇，重练已学材料加深理解，让学过的内容不再遗忘。',
})

const { load, play, pause: _pause, togglePlay, seek, stop } = useAudioPlayer()
const audioStore = useAudioStore()

// 自动上报学习时长
useStudyTimer()

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

// 顶部子 tab
const activeTab = ref<'vocab' | 'material'>('vocab')

// ===== 单词复习 =====
const vocabList = ref<ReviewVocabItem[]>([])
const vocabLoading = ref(false)
const vocabError = ref<string | null>(null)
const vocabLoaded = ref(false)
const vocabTotal = ref(0)
const vocabKeyword = ref('')
const vocabOffset = ref(0)
const VOCAB_PAGE = 10

// 单词卡片状态机：currentIndex/isFlipped/isCompleted + toggleFlip/markKnown/markUnknown/next/reset
const {
  currentIndex: vocabCurrentIndex,
  isFlipped,
  isCompleted: vocabCompleted,
  currentWord,
  toggleFlip,
  markKnown,
  markUnknown,
  next: nextVocab,
  prev: prevVocab,
  reset: restartVocab,
} = useVocabCardState(() => vocabList.value)

async function loadVocab(append = false) {
  vocabLoading.value = true
  vocabError.value = null
  try {
    const res = await getReviewVocab(
      VOCAB_PAGE,
      append ? vocabOffset.value : 0,
      vocabKeyword.value || undefined,
    )
    if (res?.code === 200 && res.data) {
      if (append) {
        vocabList.value = [...vocabList.value, ...res.data.items]
      } else {
        vocabList.value = res.data.items
      }
      vocabTotal.value = res.data.total
    } else {
      vocabError.value = res?.message || '加载失败'
    }
  } catch {
    vocabError.value = '网络异常，请重试'
  } finally {
    vocabLoading.value = false
    vocabLoaded.value = true
  }
}

function searchVocab() {
  vocabOffset.value = 0
  vocabList.value = []
  loadVocab()
}

function loadMoreVocab() {
  vocabOffset.value += VOCAB_PAGE
  loadVocab(true)
}

const hasMoreVocab = computed(() => vocabList.value.length < vocabTotal.value)

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
const materialTotal = ref(0)
const materialKeyword = ref('')
const materialOffset = ref(0)
const MATERIAL_PAGE = 5

const questionIndex = ref(0)
const userAnswers = ref<string[]>([])
const showMaterialResult = ref(false)
const isCorrect = ref(false)

async function loadMaterial(append = false) {
  materialLoading.value = true
  materialError.value = null
  try {
    const res = await getReviewMaterial(
      MATERIAL_PAGE,
      append ? materialOffset.value : 0,
      materialKeyword.value || undefined,
    )
    if (res?.code === 200 && res.data) {
      if (append) {
        materialList.value = [...materialList.value, ...res.data.items]
      } else {
        materialList.value = res.data.items
      }
      materialTotal.value = res.data.total
      // 仅加载成功才置位，失败时保持 false 使「重试」按钮可用
      materialLoaded.value = true
    } else {
      materialError.value = res?.message || '加载失败'
    }
  } catch {
    materialError.value = '网络异常，请重试'
  } finally {
    materialLoading.value = false
  }
}

function searchMaterial() {
  materialOffset.value = 0
  materialList.value = []
  loadMaterial()
}

function loadMoreMaterial() {
  materialOffset.value += MATERIAL_PAGE
  loadMaterial(true)
}

const hasMoreMaterial = computed(() => materialList.value.length < materialTotal.value)

function switchToMaterial() {
  activeTab.value = 'material'
  loadMaterial()
}

function parseQuestions(raw: Question[] | string | null | undefined): Question[] {
  if (!raw) return []
  if (Array.isArray(raw)) return raw
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

const {
  currentIndex: materialCurrentIndex,
  isCompleted: materialCompleted,
  current: currentMaterial,
  next: nextMaterialNav,
  prev: prevMaterialNav,
  reset: resetMaterialNav,
} = useMaterialNavState(() => materialList.value)

const currentMaterialQuestions = computed<Question[]>(() => {
  if (!currentMaterial.value) return []
  return parseQuestions(currentMaterial.value.questions)
})

const currentQuestion = computed<Question | null>(() => {
  const qs = currentMaterialQuestions.value
  return qs[questionIndex.value] || null
})

const totalQuestions = computed(() => currentMaterialQuestions.value.length)
const isLastQuestion = computed(() => questionIndex.value === totalQuestions.value - 1)

async function playMaterialAudio(url: string | null) {
  if (!url) return
  if (audioStore.currentSrc !== url) {
    await load(url)
  }
  togglePlay()
}

function selectAnswer(option: string) {
  if (showMaterialResult.value) return
  userAnswers.value[questionIndex.value] = option
}

function submitAnswer() {
  const answer = userAnswers.value[questionIndex.value]
  if (!answer) return
  isCorrect.value = answer === currentQuestion.value?.answer
  showMaterialResult.value = true
}

function nextQuestion() {
  if (!isCorrect.value) {
    showMaterialResult.value = false
    userAnswers.value[questionIndex.value] = ''
    return
  }
  if (isLastQuestion.value) {
    nextMaterial()
  } else {
    questionIndex.value++
    showMaterialResult.value = false
  }
}

function prevQuestion() {
  if (questionIndex.value > 0) {
    questionIndex.value--
    showMaterialResult.value = false
  } else {
    prevMaterial()
  }
}

function nextMaterial() {
  stop()
  questionIndex.value = 0
  userAnswers.value = []
  showMaterialResult.value = false
  nextMaterialNav()
}

function prevMaterial() {
  stop()
  questionIndex.value = 0
  userAnswers.value = []
  showMaterialResult.value = false
  prevMaterialNav()
}

function restartMaterial() {
  resetMaterialNav()
  questionIndex.value = 0
  userAnswers.value = []
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
        <button class="retry-btn" @click="() => loadVocab()">重试</button>
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

      <!-- 搜索框 -->
      <div v-else-if="vocabLoaded && vocabList.length && vocabKeyword" class="search-bar">
        <el-input
          v-model="vocabKeyword"
          placeholder="搜索单词或释义..."
          clearable
          @input="searchVocab"
          @clear="searchVocab"
        />
      </div>

      <!-- 卡片内容 -->
      <div v-else-if="vocabLoaded && vocabList.length && currentWord" class="vocab-content">
        <div class="progress">{{ vocabCurrentIndex + 1 }} / {{ vocabList.length }}</div>

        <div class="flip-card" @click="toggleFlip">
          <!-- 正面 -->
          <div v-if="!isFlipped" class="card-face card-front">
            <div class="vocab-word">{{ currentWord.word }}</div>
            <div v-if="currentWord.phonetic" class="vocab-phonetic">
              {{ currentWord.phonetic }}
            </div>
            <button
              v-if="currentWord.audioUrl"
              class="audio-btn"
              @click.stop="playVocabAudio(currentWord.audioUrl)"
            >
              <svg viewBox="0 0 24 24" fill="currentColor">
                <path
                  d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"
                />
              </svg>
            </button>
          </div>

          <!-- 背面 -->
          <div v-else class="card-face card-back">
            <div class="vocab-word">{{ currentWord.word }}</div>
            <div class="vocab-meaning">{{ currentWord.meaning }}</div>
            <div v-if="currentWord.forms" class="vocab-forms">
              <span class="vocab-label">变形：</span>
              <span>{{ currentWord.forms }}</span>
            </div>
            <div v-if="currentWord.exampleSentence" class="vocab-example">
              {{ currentWord.exampleSentence }}
            </div>
            <div v-if="currentWord.exampleTranslation" class="vocab-example-trans">
              {{ currentWord.exampleTranslation }}
            </div>
          </div>
        </div>

        <!-- 底部操作区 -->
        <div class="vocab-actions">
          <button
            class="action-btn action-btn--nav"
            :disabled="vocabCurrentIndex === 0"
            @click="prevVocab"
          >
            ←
          </button>
          <button class="action-btn action-btn--success" @click="markKnown">认识</button>
          <button class="action-btn action-btn--warning" @click="markUnknown">不认识</button>
          <button class="action-btn action-btn--primary" @click="nextVocab">→</button>
        </div>

        <!-- 加载更多 -->
        <div v-if="hasMoreVocab && !vocabLoading" class="load-more">
          <button class="load-more-btn" @click="loadMoreVocab">
            加载更多 ({{ vocabTotal - vocabList.length }} 个)
          </button>
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
        <button class="retry-btn" @click="() => loadMaterial()">重试</button>
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

      <!-- 搜索框 -->
      <div v-else-if="materialLoaded && materialList.length && materialKeyword" class="search-bar">
        <el-input
          v-model="materialKeyword"
          placeholder="搜索材料标题..."
          clearable
          @input="searchMaterial"
          @clear="searchMaterial"
        />
      </div>

      <!-- 材料内容 -->
      <div
        v-else-if="materialLoaded && materialList.length && currentMaterial"
        class="material-content"
      >
        <!-- 播放器 -->
        <div v-if="currentMaterial.audioUrl" class="audio-player">
          <button class="play-btn" @click="playMaterialAudio(currentMaterial.audioUrl)">
            <svg v-if="!audioStore.isPlaying" viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5v14l11-7z" />
            </svg>
            <svg v-else viewBox="0 0 24 24" fill="currentColor">
              <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
            </svg>
          </button>
          <div class="progress-bar">
            <div
              class="progress-fill"
              :style="{
                width: `${audioStore.duration > 0 ? (audioStore.currentTime / audioStore.duration) * 100 : 0}%`,
              }"
              @click="
                (e: MouseEvent) => {
                  const rect = (e.target as HTMLElement).getBoundingClientRect()
                  const percent = (e.clientX - rect.left) / rect.width
                  seek(percent * audioStore.duration)
                }
              "
            ></div>
          </div>
          <span class="time-text">
            {{ formatTime(audioStore.currentTime) }} /
            {{ formatTime(audioStore.duration || currentMaterial.duration || 0) }}
          </span>
        </div>

        <!-- 题目卡片 -->
        <div class="material-card">
          <!-- 标题 -->
          <div class="material-header">
            <h3 class="material-title">{{ currentMaterial.title }}</h3>
          </div>

          <!-- 题目为空 -->
          <div v-if="currentMaterialQuestions.length === 0" class="empty-questions">
            <p>暂无理解题</p>
            <button class="next-btn next-btn--primary" @click="nextMaterial">下一段</button>
          </div>

          <!-- 答题区域 -->
          <div v-else class="quiz-area">
            <!-- 进度指示 -->
            <div class="quiz-progress">
              <span>题目 {{ questionIndex + 1 }} / {{ totalQuestions }}</span>
            </div>

            <!-- 题目 -->
            <div v-if="currentQuestion" class="question-card">
              <div class="question-text">{{ currentQuestion.question }}</div>

              <!-- 选项 -->
              <div class="options">
                <button
                  v-for="option in currentQuestion.options"
                  :key="option"
                  class="option-btn"
                  :class="{
                    'option-btn--selected': userAnswers[questionIndex] === option,
                    'option-btn--correct': showMaterialResult && option === currentQuestion.answer,
                    'option-btn--wrong':
                      showMaterialResult && userAnswers[questionIndex] === option && !isCorrect,
                  }"
                  :disabled="showMaterialResult"
                  @click="selectAnswer(option)"
                >
                  {{ option }}
                </button>
              </div>

              <!-- 结果反馈 -->
              <div v-if="showMaterialResult" class="result-feedback">
                <div v-if="isCorrect" class="result-correct">
                  <span class="result-icon">✓</span>
                  <span>回答正确！</span>
                </div>
                <div v-else class="result-wrong">
                  <span class="result-icon">✗</span>
                  <span>回答错误，请重试</span>
                </div>
              </div>

              <!-- 操作按钮 -->
              <div class="quiz-actions">
                <button
                  class="nav-btn"
                  :disabled="materialCurrentIndex === 0 && questionIndex === 0"
                  @click="prevQuestion"
                >
                  ←
                </button>
                <button
                  v-if="!showMaterialResult"
                  class="submit-btn"
                  :disabled="!userAnswers[questionIndex]"
                  @click="submitAnswer"
                >
                  提交答案
                </button>
                <button
                  v-else
                  class="next-btn"
                  :class="{ 'next-btn--primary': isCorrect }"
                  @click="nextQuestion"
                >
                  {{ isCorrect ? (isLastQuestion ? '下一段' : '下一题') : '重试' }}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 加载更多 -->
      <div v-if="hasMoreMaterial && !materialLoading" class="load-more">
        <button class="load-more-btn" @click="loadMoreMaterial">
          加载更多 ({{ materialTotal - materialList.length }} 个)
        </button>
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

.action-btn--nav {
  background: var(--text-3);
}

.action-btn--nav:disabled {
  opacity: 0.3;
  cursor: not-allowed;
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

.audio-player {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 0;
}

.play-btn {
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--primary);
  border: none;
  border-radius: 50%;
  color: #fff;
  cursor: pointer;
  flex-shrink: 0;
  transition: opacity 0.2s;
}

.play-btn:active {
  opacity: 0.85;
}

.play-btn svg {
  width: 16px;
  height: 16px;
}

.progress-bar {
  flex: 1;
  height: 4px;
  background: var(--border-ll);
  border-radius: 2px;
  cursor: pointer;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: var(--primary);
  border-radius: 2px;
  transition: width 0.1s linear;
}

.time-text {
  font-size: 12px;
  color: var(--text-3);
  min-width: 80px;
  text-align: right;
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

.empty-questions {
  padding: 40px;
  text-align: center;
  color: var(--text-3);
}

.quiz-progress {
  margin-bottom: 16px;
  font-size: 13px;
  color: var(--text-3);
}

.question-card {
  background: var(--bg);
  border-radius: var(--r);
  padding: 20px;
}

.result-feedback {
  margin-bottom: 16px;
  padding: 12px;
  border-radius: var(--r);
  display: flex;
  align-items: center;
  gap: 8px;
}

.result-correct {
  background: rgba(103, 194, 58, 0.1);
  color: var(--success);
}

.result-wrong {
  background: rgba(245, 108, 108, 0.1);
  color: var(--danger);
}

.result-icon {
  font-size: 16px;
  font-weight: 600;
}

.quiz-actions {
  display: flex;
  gap: 12px;
}

.nav-btn {
  padding: 12px 16px;
  background: var(--primary);
  border: none;
  border-radius: var(--r);
  color: #fff;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: opacity 0.2s;
}

.nav-btn:active:not(:disabled) {
  opacity: 0.85;
}

.nav-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.submit-btn,
.next-btn {
  flex: 1;
  padding: 12px;
  border: 1px solid var(--border-ll);
  border-radius: var(--r);
  background: var(--card);
  color: var(--text-2);
  font-size: 14px;
  cursor: pointer;
  transition: all 0.2s;
}

.submit-btn:disabled,
.next-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.submit-btn:not(:disabled):active,
.next-btn:not(:disabled):active {
  background: var(--bg);
}

.next-btn--primary {
  background: var(--primary);
  border-color: var(--primary);
  color: #fff;
}

.next-btn--primary:not(:disabled):active {
  opacity: 0.9;
}

/* ===== 搜索框 ===== */
.search-bar {
  margin-bottom: 16px;
}

/* ===== 加载更多 ===== */
.load-more {
  display: flex;
  justify-content: center;
  margin-top: 16px;
}

.load-more-btn {
  padding: 8px 24px;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--r);
  color: var(--text-2);
  font-size: 13px;
  cursor: pointer;
  transition:
    color 0.2s,
    border-color 0.2s;
}

.load-more-btn:hover {
  color: var(--primary);
  border-color: var(--primary);
}
</style>
