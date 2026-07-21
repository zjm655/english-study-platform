import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref } from 'vue'
import { mount } from '@vue/test-utils'
import ShadowReading from '../ShadowReading.vue'
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
    stop: vi.fn(),
  }),
}))

vi.mock('~/composables/media/useRecorder', () => ({
  useRecorder: () => ({
    start: vi.fn(),
    stop: vi.fn(),
    isRecording: ref(false),
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
  useUploadRecording: () => ({
    execute: vi.fn(),
  }),
  useAnalyzeRecording: () => ({
    execute: vi.fn(),
  }),
}))

vi.mock('~/composables/evaluation/useSpeechEvaluation', () => ({
  useSpeechEvaluation: () => ({
    initEngine: vi.fn(),
    startRealtime: vi.fn(),
    stopRealtime: vi.fn(),
    getRecordedAudio: vi.fn(() => null),
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
  translation: null,
  questions: null,
  unitId: 1,
  unitTitle: 'Unit 1',
  vocabulary: [],
  progress: {
    phase1_done: true,
    phase2_done: true,
    phase3_done: true,
    phase3_score: 80,
    phase4_done: false,
    phase4_score: null,
  },
}

function mountComponent(segmentOverrides: Partial<SegmentDetail> = {}) {
  return mount(ShadowReading, {
    props: {
      segment: { ...mockSegment, ...segmentOverrides },
    },
    global: {
      stubs: {
        RecordingHistoryList: { template: '<div class="mock-history-list"></div>', props: true },
        EvaluationResultCard: { template: '<div class="mock-eval-card"></div>', props: true },
        DotPulse: { template: '<span class="mock-dot-pulse"></span>' },
      },
    },
  })
}

describe('ShadowReading 影子跟读组件', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('渲染戴耳机提示', () => {
    const wrapper = mountComponent()
    const tip = wrapper.find('.headphone-tip')
    expect(tip.exists()).toBe(true)
    expect(tip.text()).toContain('请佩戴耳机')
    expect(tip.text()).toContain('跟随音频朗读')
  })

  it('idle 状态下显示开始跟读按钮（无历史）', () => {
    const wrapper = mountComponent()
    const btn = wrapper.find('.start-btn')
    expect(btn.exists()).toBe(true)
    expect(btn.text()).toBe('开始跟读')
  })

  it('idle 状态下不显示 running 状态', () => {
    const wrapper = mountComponent()
    expect(wrapper.find('.running-state').exists()).toBe(false)
  })

  it('未选择录音时 AI 评分区显示空状态提示', () => {
    const wrapper = mountComponent()
    const aiCard = wrapper.findAll('.card')[0]
    expect(aiCard!.find('.empty-state').text()).toContain('选择一条跟读记录查看评分')
  })

  it('完成按钮在 canComplete 为 false 时禁用', () => {
    const wrapper = mountComponent()
    const btn = wrapper.find('.complete-btn')
    expect(btn.attributes('disabled')).toBeDefined()
    expect(btn.classes()).not.toContain('complete-btn--active')
  })

  it('渲染历史跟读列表', () => {
    const wrapper = mountComponent()
    expect(wrapper.find('.mock-history-list').exists()).toBe(true)
  })
})
