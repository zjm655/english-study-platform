<script setup lang="ts">
import { useUpdateProgress } from '~/composables/unit'
import type { SegmentDetail, Question } from '~~/shared/types/unit'

interface Props {
  segment: SegmentDetail
}

const props = defineProps<Props>()
const emit = defineEmits<{
  (e: 'complete'): void
}>()

const { execute: updateProgress, isLoading } = useUpdateProgress()

// 解析 questions（后端可能返回数组或 JSON 字符串）
const questions = computed<Question[]>(() => {
  const raw = props.segment.questions
  if (!raw) return []
  if (Array.isArray(raw)) return raw
  try {
    return JSON.parse(raw)
  } catch {
    return []
  }
})

// 当前题目索引
const currentIndex = ref(0)
// 用户答案
const userAnswers = ref<string[]>([])
// 是否显示结果
const showResult = ref(false)
// 是否正确
const isCorrect = ref(false)

const currentQuestion = computed(() => questions.value[currentIndex.value])
const totalQuestions = computed(() => questions.value.length)
const isLastQuestion = computed(() => currentIndex.value === totalQuestions.value - 1)

// 选择答案
function selectAnswer(option: string) {
  userAnswers.value[currentIndex.value] = option
}

// 提交答案
function submitAnswer() {
  const answer = userAnswers.value[currentIndex.value]
  if (!answer) return

  isCorrect.value = answer === currentQuestion.value?.answer
  showResult.value = true
}

// 下一题
function nextQuestion() {
  if (!isCorrect.value) {
    // 答错了，重置当前题
    showResult.value = false
    userAnswers.value[currentIndex.value] = ''
    return
  }

  if (isLastQuestion.value) {
    // 最后一题答对，完成阶段
    completePhase()
  } else {
    // 下一题
    currentIndex.value++
    showResult.value = false
  }
}

// 完成阶段
async function completePhase() {
  const res = await updateProgress({
    segmentId: props.segment.id,
    phase: 1,
    done: true
  })

  if (res?.code === 200) {
    emit('complete')
  }
}

// 重新开始
function restart() {
  currentIndex.value = 0
  userAnswers.value = []
  showResult.value = false
  isCorrect.value = false
}
</script>

<template>
  <div class="blind-listening">
    <!-- 题目为空 -->
    <div v-if="questions.length === 0" class="empty-questions">
      <p>暂无理解题</p>
    </div>

    <!-- 答题区域 -->
    <div v-else class="quiz-area">
      <!-- 进度指示 -->
      <div class="quiz-progress">
        <span>题目 {{ currentIndex + 1 }} / {{ totalQuestions }}</span>
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
              'option-btn--selected': userAnswers[currentIndex] === option,
              'option-btn--correct': showResult && option === currentQuestion.answer,
              'option-btn--wrong': showResult && userAnswers[currentIndex] === option && !isCorrect
            }"
            :disabled="showResult"
            @click="selectAnswer(option)"
          >
            {{ option }}
          </button>
        </div>

        <!-- 结果反馈 -->
        <div v-if="showResult" class="result-feedback">
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
            v-if="!showResult"
            class="submit-btn"
            :disabled="!userAnswers[currentIndex] || isLoading"
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
            {{ isCorrect ? (isLastQuestion ? '完成' : '下一题') : '重试' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.blind-listening {
  width: 100%;
}

.empty-questions {
  padding: 40px;
  text-align: center;
  color: var(--text-3);
}

/* 进度指示 */
.quiz-progress {
  margin-bottom: 16px;
  font-size: 13px;
  color: var(--text-3);
}

/* 题目卡片 */
.question-card {
  background: var(--bg);
  border-radius: var(--r);
  padding: 20px;
}

.question-text {
  font-size: 16px;
  font-weight: 500;
  color: var(--text-1);
  margin-bottom: 20px;
  line-height: 1.5;
}

/* 选项 */
.options {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 20px;
}

.option-btn {
  width: 100%;
  padding: 14px 16px;
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

.option-btn--selected {
  border-color: var(--primary);
  background: rgba(64, 158, 255, 0.05);
}

.option-btn--correct {
  border-color: var(--success);
  background: rgba(103, 194, 58, 0.1);
}

.option-btn--wrong {
  border-color: var(--danger);
  background: rgba(245, 108, 108, 0.1);
}

.option-btn:disabled {
  cursor: not-allowed;
}

/* 结果反馈 */
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

/* 操作按钮 */
.quiz-actions {
  display: flex;
  gap: 12px;
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
</style>
