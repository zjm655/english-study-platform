import { useRecordingList } from './useRecordingList'
import { useAudioPlayer } from '~/composables/media/useAudioPlayer'
import type { Recording } from '#shared/types/recording'
import { formatDuration } from '#shared/utils/format'

/**
 * 录音历史列表共享逻辑（Phase3 配音 / Phase4 跟读复用）。
 * 仅封装列表加载、选中、最高分门禁与录音回放；
 * 是否禁用播放（如 Phase4 跟读进行中）交由 UI 层 playDisabled 控制。
 */
export function useRecordingHistory(segmentId: number, phase: 3 | 4) {
  const { execute: fetchRecordingList, isLoading: isListLoading } = useRecordingList()
  const { load: loadAudio, play: playAudio } = useAudioPlayer()

  const recordings = ref<Recording[]>([])
  const totalRecordings = ref(0)
  const selectedRecordingId = ref<number | null>(null)
  const isListError = ref(false)
  const listErrorMsg = ref('')
  const isListLoadingMore = ref(false)

  // 是否还有更多历史记录
  const hasMoreRecordings = computed(() =>
    recordings.value.length < totalRecordings.value
  )

  // 当前选中的录音
  const selectedRecording = computed(() =>
    recordings.value.find(r => r.id === selectedRecordingId.value) || null
  )

  // 选中录音是否已有评分
  const hasAnalysis = computed(() =>
    selectedRecording.value?.score !== null && selectedRecording.value?.score !== undefined
  )

  // 最高分
  const bestScore = computed(() => {
    const scores = recordings.value
      .filter(r => r.score !== null)
      .map(r => r.score as number)
    return scores.length > 0 ? Math.max(...scores) : null
  })

  // 完成按钮是否可用
  const canComplete = computed(() => bestScore.value !== null)

  // 选中一条录音
  function selectRecording(id: number) {
    selectedRecordingId.value = id
  }

  // 新分析/跟读完成的记录前插入列表并选中
  function addRecording(rec: Recording) {
    recordings.value.unshift(rec)
    totalRecordings.value++
    selectedRecordingId.value = rec.id
  }

  // 从已签名 URL 推断 Howler 格式提示：录音统一为 opus 编码，
  // ogg 容器显式按 opus 门控，避免 Howler 默认按 vorbis 误判而报“加载失败”
  function recordingFormat(url: string): string | undefined {
    const ext = (url.split('?')[0] ?? '').split('.').pop()?.toLowerCase()
    if (!ext) return undefined
    if (ext === 'ogg') return 'opus'
    if (/^(webm|wav|mp3|m4a|mp4|opus)$/.test(ext)) return ext
    return undefined
  }

  // 播放选中的录音
  async function playRecording() {
    if (!selectedRecording.value?.audioPath) return

    let url = selectedRecording.value.audioPath
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = url.startsWith('/') ? url : `/${url}`
    }
    const format = recordingFormat(url)
    await loadAudio(url, format ? { format } : undefined)
    playAudio()
  }

  // 加载录音列表（第一页）
  async function loadRecordings() {
    isListError.value = false
    listErrorMsg.value = ''
    try {
      const res = await fetchRecordingList({
        segmentId,
        phase,
        page: 1,
        size: 3,
      })
      if (res?.code === 200 && res.data) {
        recordings.value = res.data.items
        totalRecordings.value = res.data.total
      } else {
        isListError.value = true
        listErrorMsg.value = res?.message || '加载录音列表失败'
      }
    } catch (err) {
      logger.error('加载录音列表失败:', err)
      isListError.value = true
      listErrorMsg.value = '网络异常，加载录音列表失败'
    }
  }

  // 加载更多历史录音
  async function loadMoreRecordings() {
    if (isListLoadingMore.value || !hasMoreRecordings.value) return
    isListLoadingMore.value = true
    try {
      const nextPage = Math.floor(recordings.value.length / 3) + 1
      const res = await fetchRecordingList({
        segmentId,
        phase,
        page: nextPage,
        size: 3,
      })
      if (res?.code === 200 && res.data) {
        recordings.value = [...recordings.value, ...res.data.items]
        totalRecordings.value = res.data.total
      }
    } catch (err) {
      logger.error('加载更多录音失败:', err)
    } finally {
      isListLoadingMore.value = false
    }
  }

  return {
    recordings,
    totalRecordings,
    selectedRecordingId,
    isListLoading,
    isListError,
    listErrorMsg,
    isListLoadingMore,
    hasMoreRecordings,
    selectedRecording,
    hasAnalysis,
    bestScore,
    canComplete,
    formatDuration,
    selectRecording,
    addRecording,
    playRecording,
    loadRecordings,
    loadMoreRecordings,
  }
}
