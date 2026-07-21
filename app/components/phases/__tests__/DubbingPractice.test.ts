import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref } from 'vue'
import { mount } from '@vue/test-utils'
import DubbingPractice from '../DubbingPractice.vue'
import type { SegmentDetail } from '#shared/types/unit'

// Mock composables
vi.mock('~/composables/unit', () => ({
  useUpdateProgress: () => ({
    execute: vi.fn(),
    isLoading: ref(false),
  }),
}))

vi.mock('~/composables/media/useAudioPlayer', () => ({
  useAudioPlayer: () => ({
    load: vi.fn(),
    play: vi.fn(),
  }),
}))

vi.mock('~/composables/recording', () => ({
  useRecordingHistory: () => ({
    recordings: ref([]),
    totalRecordings: ref(0),
    selectedRecordingId: ref(null),
    isListLoading: ref(false),
    isListError: ref(false),
    listErrorMsg: ref(''),
    isListLoadingMore: ref(false),
    hasMoreRecordings: ref(false),
    selectedRecording: ref(null),
    hasAnalysis: ref(false),
    bestScore: ref(null),
    canComplete: ref(false),
    selectRecording: vi.fn(),
    addRecording: vi.fn(),
    playRecording: vi.fn(),
    loadRecordings: vi.fn(),
    loadMoreRecordings: vi.fn(),
  }),
  useAnalyzeRecording: () => ({
    execute: vi.fn(),
    isLoading: ref(false),
  }),
}))

vi.mock('~/composables/evaluation/useSpeechEvaluation', () => ({
  useSpeechEvaluation: () => ({
    isLoading: ref(false),
    initEngine: vi.fn(),
    analyzeRecording: vi.fn(),
    destroy: vi.fn(),
  }),
}))

vi.mock('~/store/useUserStore', () => ({
  useUserStore: () => ({
    user: { id: 1 },
  }),
}))

vi.mock('~/api/evaluation/auth', () => ({
  getEvaluationAuth: vi.fn(),
}))

vi.mock('~/utils/popup', () => ({
  toastError: vi.fn(),
}))

const mockSegment: SegmentDetail = {
  id: 1,
  title: 'Test Segment',
  audioUrl: 'https://example.com/audio.mp3',
  duration: 10,
  textContent: 'Hello world, this is a test.',
  translation: '你好世界，这是一个测试。',
  questions: null,
  unitId: 1,
  unitTitle: 'Unit 1',
  vocabulary: [],
  progress: {
    phase1_done: true,
    phase2_done: true,
    phase3_done: false,
    phase3_score: null,
    phase4_done: false,
    phase4_score: null,
  },
}

function mountComponent(segmentOverrides: Partial<SegmentDetail> = {}) {
  return mount(DubbingPractice, {
    props: {
      segment: { ...mockSegment, ...segmentOverrides },
    },
    global: {
      stubs: {
        RecordingHistoryList: { template: '<div class="mock-history-list"></div>', props: true },
        VoiceRecorder: { template: '<div class="mock-voice-recorder"></div>', props: true },
        EvaluationResultCard: { template: '<div class="mock-eval-card"></div>', props: true },
        DotPulse: { template: '<span class="mock-dot-pulse"></span>' },
      },
    },
  })
}

describe('DubbingPractice 配音练习组件', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('渲染原文内容', () => {
    const wrapper = mountComponent()
    expect(wrapper.find('.text-content').text()).toBe('Hello world, this is a test.')
  })

  it('原文卡片包含播放材料按钮', () => {
    const wrapper = mountComponent()
    const playBtn = wrapper.find('.material-play-btn')
    expect(playBtn.exists()).toBe(true)
    expect(playBtn.text()).toContain('播放材料')
  })

  it('无 audioUrl 时不渲染播放材料按钮', () => {
    const wrapper = mountComponent({ audioUrl: null })
    expect(wrapper.find('.material-play-btn').exists()).toBe(false)
  })

  it('渲染翻译折叠区域，默认折叠', () => {
    const wrapper = mountComponent()
    const el = wrapper.find('.translation-content')
    expect(el.exists()).toBe(true)
    // v-show="false" 设置 display: none
    expect(el.attributes('style')).toContain('display: none')
  })

  it('点击翻译标题展开翻译内容', async () => {
    const wrapper = mountComponent()
    await wrapper.find('.card__header--clickable').trigger('click')
    expect(wrapper.find('.translation-content').isVisible()).toBe(true)
    expect(wrapper.find('.translation-content').text()).toContain('你好世界')
  })

  it('无翻译时显示暂无翻译', async () => {
    const wrapper = mountComponent({ translation: null })
    await wrapper.find('.card__header--clickable').trigger('click')
    expect(wrapper.find('.translation-content').text()).toContain('暂无翻译')
  })

  it('未选择录音时 AI 评分区显示空状态提示', () => {
    const wrapper = mountComponent()
    const aiCard = wrapper.findAll('.card')[2]
    expect(aiCard!.find('.empty-state').text()).toContain('选择一条录音并发起分析')
  })

  it('完成按钮在 canComplete 为 false 时禁用', () => {
    const wrapper = mountComponent()
    const btn = wrapper.find('.complete-btn')
    expect(btn.attributes('disabled')).toBeDefined()
    expect(btn.classes()).not.toContain('complete-btn--active')
  })

  it('渲染录音卡片（可折叠区域）', () => {
    const wrapper = mountComponent()
    expect(wrapper.find('.recording-card-bottom').exists()).toBe(true)
  })
})
