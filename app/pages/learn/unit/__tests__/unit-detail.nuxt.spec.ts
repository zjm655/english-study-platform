import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { ref } from 'vue'
import UnitDetail from '../[id]/index.vue'

// Mock vue-router useRoute (Nuxt auto-import)
vi.mock('vue-router', () => ({
  useRoute: () => ({ params: { id: '1' }, query: {}, path: '/', fullPath: '/' }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}))

// Mock useUnitProgress
const mockIsLoading = ref(false)
const mockIsLoadingMore = ref(false)
const mockFetchUnitProgress = vi.fn()
const mockLoadMore = vi.fn()
vi.mock('~/composables/unit/useUnitProgress', () => ({
  useUnitProgress: () => ({
    isLoading: mockIsLoading,
    isLoadingMore: mockIsLoadingMore,
    fetchUnitProgress: mockFetchUnitProgress,
    loadMore: mockLoadMore,
  }),
}))

// Mock useFavorites（避免真实网络请求触发测试环境 logger 未定义）
const mockFetchFavSegments = vi.fn()
const mockIsSegmentFav = vi.fn(() => false)
const mockToggleSegment = vi.fn()
const mockTogglingSegment = ref<number | null>(null)
vi.mock('~/composables/useFavorites', () => ({
  useFavorites: () => ({
    fetchFavSegments: mockFetchFavSegments,
    isSegmentFav: mockIsSegmentFav,
    toggleSegment: mockToggleSegment,
    togglingSegment: mockTogglingSegment,
  }),
}))

const mockSuccessData = {
  code: 200,
  message: 'ok',
  data: {
    unit: {
      id: 1,
      title: '测试单元',
      description: '这是一个测试单元的描述',
      level: 1,
      sortOrder: 1,
      audioUrl: null,
    },
    segments: [
      {
        id: 1,
        title: '片段一',
        audioUrl: null,
        sortOrder: 1,
        isMine: true,
        progress: {
          phase1_done: true,
          phase2_done: false,
          phase3_done: false,
          phase3_score: null,
          phase4_done: false,
          phase4_score: null,
          updatedAt: null,
        },
      },
      {
        id: 2,
        title: '片段二',
        audioUrl: null,
        sortOrder: 2,
        isMine: false,
        progress: {
          phase1_done: true,
          phase2_done: true,
          phase3_done: true,
          phase4_done: true,
          phase3_score: 85,
          phase4_score: 90,
          updatedAt: null,
        },
      },
    ],
    pagination: { page: 1, pageSize: 10, total: 2, hasMore: false },
  },
}

function createWrapper() {
  return mount(UnitDetail, {
    global: {
      directives: {
        'infinite-scroll': {},
      },
      stubs: {
        NuxtLink: {
          props: ['to'],
          template: '<a :href="to"><slot /></a>',
        },
        'el-icon': {
          template: '<span class="el-icon-stub"><slot /></span>',
        },
        DotPulse: {
          template: '<div class="dot-pulse-mock">Loading...</div>',
        },
      },
    },
  })
}

describe('UnitDetail Page', () => {
  beforeEach(() => {
    mockIsLoading.value = false
    mockIsLoadingMore.value = false
    mockFetchUnitProgress.mockReset()
    mockLoadMore.mockReset()
    mockFetchUnitProgress.mockResolvedValue(mockSuccessData)
  })

  it('renders loading state when isLoading is true', () => {
    mockIsLoading.value = true
    const wrapper = createWrapper()
    expect(wrapper.find('.loading-container').exists()).toBe(true)
    expect(wrapper.find('.dot-pulse-mock').exists()).toBe(true)
  })

  it('renders unit title and description after loading', async () => {
    const wrapper = createWrapper()
    // 等待 onMounted 中的异步操作完成
    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('测试单元')
    })
    expect(wrapper.text()).toContain('这是一个测试单元的描述')
  })

  it('renders segment cards with correct titles', async () => {
    const wrapper = createWrapper()
    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('片段一')
    })
    expect(wrapper.text()).toContain('片段二')
  })

  it('renders phase dots with correct states', async () => {
    const wrapper = createWrapper()
    await vi.waitFor(() => {
      const cards = wrapper.findAll('.segment-card')
      expect(cards.length).toBe(2)
    })
    const cards = wrapper.findAll('.segment-card')
    const firstCardPhases = cards[0]!.findAll('.phase-dot')
    expect(firstCardPhases.length).toBe(4)
    // 第一个卡片：phase1_done=true → 第一个圆点有 done 类
    expect(firstCardPhases[0]!.classes()).toContain('phase-dot--done')
    // phase2_done=false, 是第一个未完成的 → current
    expect(firstCardPhases[1]!.classes()).toContain('phase-dot--current')
    // phase3/4_done=false → 普通 pending
    expect(firstCardPhases[2]!.classes()).not.toContain('phase-dot--done')
    expect(firstCardPhases[2]!.classes()).not.toContain('phase-dot--current')
  })

  it('renders all done for fully completed segment', async () => {
    const wrapper = createWrapper()
    await vi.waitFor(() => {
      const cards = wrapper.findAll('.segment-card')
      expect(cards.length).toBe(2)
    })
    const cards = wrapper.findAll('.segment-card')
    const secondCardPhases = cards[1]!.findAll('.phase-dot')
    secondCardPhases.forEach((dot) => {
      expect(dot.classes()).toContain('phase-dot--done')
    })
  })

  it('shows empty state when no segments', async () => {
    mockFetchUnitProgress.mockResolvedValue({
      code: 200,
      message: 'ok',
      data: {
        unit: {
          id: 1,
          title: '测试单元',
          description: null,
          level: 1,
          sortOrder: 1,
          audioUrl: null,
        },
        segments: [],
        pagination: { page: 1, pageSize: 10, total: 0, hasMore: false },
      },
    })
    const wrapper = createWrapper()
    await vi.waitFor(() => {
      expect(wrapper.find('.empty-state').exists()).toBe(true)
    })
    expect(wrapper.text()).toContain('暂无片段数据')
  })

  it('shows error state when API returns non-200', async () => {
    mockFetchUnitProgress.mockResolvedValue({
      code: 500,
      message: '服务器错误',
      data: null,
    })
    const wrapper = createWrapper()
    await vi.waitFor(() => {
      expect(wrapper.find('.error-container').exists()).toBe(true)
    })
    expect(wrapper.text()).toContain('服务器错误')
    expect(wrapper.find('.retry-btn').exists()).toBe(true)
  })

  it('links to correct segment pages', async () => {
    const wrapper = createWrapper()
    await vi.waitFor(() => {
      const cards = wrapper.findAll('.segment-card')
      expect(cards.length).toBe(2)
    })
    const cards = wrapper.findAll('.segment-card')
    expect(cards[0]!.find('.segment-card__link').attributes('href')).toBe('/learn/unit/1/segment/1')
    expect(cards[1]!.find('.segment-card__link').attributes('href')).toBe('/learn/unit/1/segment/2')
  })

  it('marks own segments with badge and highlight', async () => {
    const wrapper = createWrapper()
    await vi.waitFor(() => {
      const cards = wrapper.findAll('.segment-card')
      expect(cards.length).toBe(2)
    })
    const cards = wrapper.findAll('.segment-card')
    // 片段一 isMine=true → 高亮类 + 「我的」角标
    expect(cards[0]!.classes()).toContain('segment-card--mine')
    expect(cards[0]!.find('.segment-card__badge').exists()).toBe(true)
    expect(cards[0]!.find('.segment-card__badge').text()).toBe('我的')
    // 片段二 isMine=false → 无高亮与角标
    expect(cards[1]!.classes()).not.toContain('segment-card--mine')
    expect(cards[1]!.find('.segment-card__badge').exists()).toBe(false)
  })
})
