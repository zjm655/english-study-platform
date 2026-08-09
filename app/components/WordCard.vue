<script setup lang="ts">
import { useAudioPlayer } from '~/composables/media/useAudioPlayer'
import { resolveGuestAudioUrl } from '~/composables/media/useGuestAudio'
import type { VocabularyItem } from '#shared/types/unit'
import { toastError } from '~/utils/popup'

interface Props {
  vocab: VocabularyItem
  /** 是否已收藏（由父页面注入，本组件不调用 useFavorites） */
  favActive: boolean
  /** 收藏按钮禁用（toggle 进行中） */
  favDisabled?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  favDisabled: false,
})

const emit = defineEmits<{
  (e: 'toggle-fav'): void
}>()

const { load, play } = useAudioPlayer()

async function playVocabAudio() {
  // 游客：通过 objectKey 动态获取签名 URL（与 TextLearning 同模式）
  const resolvedUrl = await resolveGuestAudioUrl(
    props.vocab.audioUrl,
    props.vocab.audioObjectKey,
    'word',
  )
  if (!resolvedUrl) {
    toastError('今日音频播放次数已用完，登录后可无限使用')
    return
  }
  await load(resolvedUrl)
  play()
}
</script>

<template>
  <div class="word-card">
    <div class="word-card__head">
      <div class="vocab-word-row">
        <span class="vocab-word">{{ vocab.word }}</span>
        <button
          v-if="vocab.audioUrl || vocab.audioObjectKey"
          class="audio-btn"
          title="播放发音"
          @click="playVocabAudio"
        >
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path
              d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"
            />
          </svg>
        </button>
      </div>
      <button
        class="fav-btn"
        :class="{ 'fav-btn--active': favActive }"
        :disabled="favDisabled"
        title="收藏"
        @click="emit('toggle-fav')"
      >
        <svg viewBox="0 0 24 24" fill="currentColor">
          <path
            d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"
          />
        </svg>
      </button>
    </div>

    <div v-if="vocab.phonetic" class="vocab-phonetic">
      {{ vocab.phonetic }}
    </div>

    <div class="vocab-meaning">
      {{ vocab.meaning }}
    </div>

    <div v-if="vocab.forms" class="vocab-forms">
      <span class="forms-label">变形：</span>
      <span class="forms-value">{{ vocab.forms }}</span>
    </div>
  </div>
</template>

<style scoped>
.word-card {
  padding: 14px;
  background: var(--card);
  border: 1px solid var(--border-ll);
  border-radius: var(--r);
}

.word-card__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.vocab-word-row {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.vocab-word {
  font-size: 20px;
  font-weight: 600;
  color: var(--text-1);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.audio-btn {
  flex-shrink: 0;
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
  margin-top: 4px;
  font-size: 14px;
  color: var(--text-2);
  font-family: 'Times New Roman', serif;
}

.vocab-meaning {
  margin-top: 6px;
  font-size: 15px;
  color: var(--text-1);
  line-height: 1.5;
}

.vocab-forms {
  margin-top: 6px;
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
  flex-shrink: 0;
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
</style>
