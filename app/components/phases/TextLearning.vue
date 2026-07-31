<script setup lang="ts">
import { useUpdateProgress } from '~/composables/unit'
import { useAudioPlayer } from '~/composables/media/useAudioPlayer'
import { useFavorites } from '~/composables/useFavorites'
import { resolveGuestAudioUrl } from '~/composables/media/useGuestAudio'
import type { SegmentDetail, VocabularyItem } from '~~/shared/types/unit'
import { toastError } from '~/utils/popup'

interface Props {
  segment: SegmentDetail
}

const props = defineProps<Props>()
const emit = defineEmits<{
  (e: 'complete'): void
}>()

const { execute: updateProgress, isLoading: isUpdating } = useUpdateProgress()
const { load, play } = useAudioPlayer()
const { fetchFavWords, isWordFav, toggleWord, togglingWord } = useFavorites()

// 页面加载时拉取收藏列表
onMounted(() => {
  fetchFavWords()
})

// ===== 状态 =====
const selectedVocab = ref<VocabularyItem | null>(null)
const translationExpanded = ref(false)
const vocabCardRef = ref<HTMLElement | null>(null)

// ===== Tokenization =====
interface Token {
  text: string
  isWord: boolean
  vocab?: VocabularyItem
  isFirstOccurrence?: boolean
}

const tokens = computed<Token[]>(() => {
  const text = props.segment.textContent
  if (!text) return []

  // 1. 按指定正则分词
  const rawTokens = text.split(/(\s+|[.,!?;:"])/g).filter(Boolean)

  // 2. 构建词汇查找表（小写映射）
  const vocabMap = new Map<string, VocabularyItem>()
  for (const v of props.segment.vocabulary || []) {
    vocabMap.set(v.word.toLowerCase(), v)
    if (v.forms) {
      const formList = v.forms
        .split(/[,;]/)
        .map((s) => s.trim())
        .filter(Boolean)
      for (const form of formList) {
        vocabMap.set(form.toLowerCase(), v)
      }
    }
  }

  // 3. 为每个 token 匹配词汇（首次出现加背景，后续只保留下划线）
  const seenVocabIds = new Set<number>()

  return rawTokens.map((token) => {
    const isWord = /[a-zA-Z]/.test(token)
    if (!isWord) return { text: token, isWord: false }

    // 去除首尾标点后的纯净形式用于匹配
    const clean = token.toLowerCase().replace(/^[.,!?;:"]+|[.,!?;:"]+$/g, '')
    const vocab = clean ? vocabMap.get(clean) : undefined

    if (vocab) {
      const isFirst = !seenVocabIds.has(vocab.id)
      if (isFirst) seenVocabIds.add(vocab.id)
      return { text: token, isWord: true, vocab, isFirstOccurrence: isFirst }
    }

    return { text: token, isWord: true, vocab }
  })
})

// ===== 交互处理 =====

function handleVocabClick(vocab: VocabularyItem) {
  selectedVocab.value = vocab
  // 下一帧滚动到词汇卡片
  nextTick(() => {
    vocabCardRef.value?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  })
}

async function playVocabAudio(url: string | null, objectKey?: string | null) {
  // 游客：通过 objectKey 动态获取签名 URL
  const resolvedUrl = await resolveGuestAudioUrl(url, objectKey, 'word')
  if (!resolvedUrl) {
    toastError('今日音频播放次数已用完，登录后可无限使用')
    return
  }
  await load(resolvedUrl)
  play()
}

async function playMaterialAudio() {
  // 游客：通过 audioObjectKey 动态获取签名 URL
  const resolvedUrl = await resolveGuestAudioUrl(
    props.segment.audioUrl,
    props.segment.audioObjectKey,
    'material',
  )
  if (!resolvedUrl) {
    toastError('今日音频播放次数已用完，登录后可无限使用')
    return
  }
  await load(resolvedUrl)
  play()
}

async function completePhase() {
  const res = await updateProgress({
    segmentId: props.segment.id,
    phase: 2,
    done: true,
  })
  if (res?.code === 200) {
    emit('complete')
  }
}
</script>

<template>
  <div class="text-learning">
    <!-- 卡片 a：文本卡片 -->
    <div class="card text-card">
      <div class="card__header">
        <span>原文</span>
        <button v-if="segment.audioUrl || segment.audioObjectKey" class="material-play-btn" @click="playMaterialAudio">
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M8 5v14l11-7z" />
          </svg>
          播放材料
        </button>
      </div>
      <p class="tokenized-text">
        <template v-for="(token, i) in tokens" :key="i">
          <span
            v-if="token.vocab"
            class="token token--vocab"
            :class="{
              'token--first': token.isFirstOccurrence,
              'token--active': selectedVocab?.id === token.vocab.id,
            }"
            @click="handleVocabClick(token.vocab)"
          >
            {{ token.text }}
          </span>
          <span v-else class="token" :class="{ 'token--punct': !token.isWord }">
            {{ token.text }}
          </span>
        </template>
      </p>
    </div>

    <!-- 卡片 b：词汇卡片 -->
    <div ref="vocabCardRef" class="card vocab-card">
      <div class="card__header">
        <span>词汇详情</span>
        <button
          v-if="selectedVocab"
          class="fav-btn"
          :class="{ 'fav-btn--active': isWordFav(selectedVocab.id) }"
          :disabled="togglingWord === selectedVocab.id"
          @click.stop="toggleWord(selectedVocab.id)"
        >
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path
              d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"
            />
          </svg>
        </button>
      </div>

      <!-- 未选中状态 -->
      <div v-if="!selectedVocab" class="vocab-placeholder">点击上方高亮词汇查看详情</div>

      <!-- 选中状态 -->
      <div v-else class="vocab-detail">
        <div class="vocab-word-row">
          <span class="vocab-word">{{ selectedVocab.word }}</span>
          <button
            v-if="selectedVocab.audioUrl || selectedVocab.audioObjectKey"
            class="audio-btn"
            @click="playVocabAudio(selectedVocab.audioUrl, selectedVocab.audioObjectKey)"
          >
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path
                d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"
              />
            </svg>
          </button>
        </div>

        <div v-if="selectedVocab.phonetic" class="vocab-phonetic">
          {{ selectedVocab.phonetic }}
        </div>

        <div class="vocab-meaning">
          {{ selectedVocab.meaning }}
        </div>

        <div v-if="selectedVocab.forms" class="vocab-forms">
          <span class="forms-label">变形：</span>
          <span class="forms-value">{{ selectedVocab.forms }}</span>
        </div>
      </div>
    </div>

    <!-- 卡片 c：翻译卡片 -->
    <div class="card translation-card">
      <button class="translation-header" @click="translationExpanded = !translationExpanded">
        <span>翻译</span>
        <span
          class="translation-toggle"
          :class="{ 'translation-toggle--expanded': translationExpanded }"
        >
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z" />
          </svg>
        </span>
      </button>
      <div v-show="translationExpanded" class="translation-body">
        {{ segment.translation || '暂无翻译' }}
      </div>
    </div>

    <!-- 完成按钮 -->
    <button class="complete-btn" :disabled="isUpdating" @click="completePhase">
      {{ isUpdating ? '更新中...' : '完成学习' }}
    </button>
  </div>
</template>

<style scoped>
.text-learning {
  width: 100%;
  max-height: 100%;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* ===== 通用卡片样式 ===== */
.card {
  background: var(--card);
  border-radius: var(--r-lg);
  box-shadow: var(--shadow);
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

.material-play-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  background: var(--primary-light);
  border: 1px solid var(--border-ll);
  border-radius: var(--r);
  color: var(--primary);
  font-size: 12px;
  cursor: pointer;
  transition: all 0.2s;
}

.material-play-btn svg {
  width: 14px;
  height: 14px;
}

.material-play-btn:active {
  background: var(--primary);
  color: #fff;
}

/* ===== 文本卡片 ===== */
.tokenized-text {
  font-size: 16px;
  line-height: 1.8;
  color: var(--text-1);
  word-wrap: break-word;
}

.token {
  display: inline;
}

.token--punct {
  color: var(--text-2);
}

.token--vocab {
  border-bottom: 2px solid var(--warning);
  cursor: pointer;
  transition: all 0.2s;
}

.token--vocab.token--first {
  background: var(--warning-light);
}

.token--vocab:hover {
  background: rgba(230, 162, 60, 0.2);
}

.token--vocab.token--active {
  background: var(--warning);
}

/* ===== 词汇卡片 ===== */
.vocab-placeholder {
  padding: 24px;
  text-align: center;
  color: var(--text-3);
  font-size: 14px;
  background: var(--bg);
  border-radius: var(--r);
}

.vocab-detail {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.vocab-word-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.vocab-word {
  font-size: 20px;
  font-weight: 600;
  color: var(--text-1);
}

.audio-btn {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--primary-light);
  border: none;
  border-radius: 50%;
  color: var(--primary);
  cursor: pointer;
  transition: all 0.2s;
}

.audio-btn:active {
  background: var(--primary);
  color: #fff;
}

.audio-btn svg {
  width: 18px;
  height: 18px;
}

.vocab-phonetic {
  font-size: 14px;
  color: var(--text-2);
  font-family: 'Times New Roman', serif;
}

.vocab-meaning {
  font-size: 15px;
  color: var(--text-1);
  line-height: 1.5;
}

.vocab-forms {
  font-size: 13px;
  color: var(--text-2);
}

.forms-label {
  color: var(--text-3);
}

.forms-value {
  color: var(--text-2);
}

/* ===== 收藏按钮 ===== */
.fav-btn {
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
}

.fav-btn svg {
  width: 18px;
  height: 18px;
}

.fav-btn:active:not(:disabled) {
  color: var(--warning);
  transform: scale(1.1);
}

.fav-btn:hover:not(:disabled) {
  transform: scale(0.95);
}

.fav-btn--active {
  color: var(--warning);
}

.fav-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* ===== 翻译卡片 ===== */
.translation-header {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0;
  background: none;
  border: none;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-1);
  cursor: pointer;
}

.translation-toggle {
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-3);
  transition: transform 0.2s;
}

.translation-toggle svg {
  width: 20px;
  height: 20px;
}

.translation-toggle--expanded {
  transform: rotate(180deg);
}

.translation-body {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--border-ll);
  font-size: 15px;
  line-height: 1.7;
  color: var(--text-2);
}

/* ===== 完成按钮 ===== */
.complete-btn {
  width: 100%;
  padding: 14px;
  background: var(--primary);
  border: none;
  border-radius: var(--r);
  color: #fff;
  font-size: 15px;
  font-weight: 500;
  cursor: pointer;
  transition: opacity 0.2s;
  margin-top: 4px;
}

.complete-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.complete-btn:not(:disabled):active {
  opacity: 0.9;
}
</style>
