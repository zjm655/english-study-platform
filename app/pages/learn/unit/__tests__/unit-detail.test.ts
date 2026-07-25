import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { ref } from 'vue'
import UnitDetail from '../[id]/index.vue'

// Mock vue-router useRoute (Nuxt auto-import)
vi.mock('vue-router', () => ({
  useRoute: () => ({ params: { id: '1' }, query: {}, path: '/', fullPath: '/' }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}))

// Mock useUserStore（页面按 isLogin 控制收藏请求/按钮）
const { mockUserStore } = vi.hoisted(() => ({
  mockUserStore: { isLogin: true },
}))
vi.mock('~/store/useUserStore', () => ({
  useUserStore: () => mockUserStore,
}))

// Mock useUnitProgress（页面仅使用 loadMore 分支；首屏已迁 useAsyncRes）
const mockIsLoadingMore = ref(false)
const mockLoadMore = vi.fn()
vi.mock('~/composables/unit/useUnitProgress', () => ({
  useUnitProgress: () => ({
    isLoading: ref(false),
    isLoadingMore: mockIsLoadingMore,
    fetchUnitProgress: vi.fn(),
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

// Stub Nuxt auto-imports（vitest 环境无 Nuxt runtime，页面内为裸全局引用）
const mockDetailRes = ref<Record<string, unknown> | undefined>(undefined)
const mockPending = ref(false)
const mockFetchError = ref<Error | null>(null)
const mockRefresh = vi.fn()
vi.stubGlobal('useAsyncRes', () => ({
  data: mockDetailRes,
  pending: mockPending,
  error: mockFetchError,
  refresh: mockRefresh,
}))
vi.stubGlobal('useSeoMeta', vi.fn())
vi.stubGlobal('useJsonLd', vi.fn())
vi.stubGlobal(
  'learningResourceSchema',
  vi.fn(() => ({})),
)
vi.stubGlobal(
  'IntersectionObserver',
  class {
    observe = vi.fn()
    unobserve = vi.fn()
    disconnect = vi.fn()
  },
)

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
    mockUserStore.isLogin = true
    mockDetailRes.value = mockSuccessData
    mockPending.value = false
    mockFetchError.value = null
    mockIsLoadingMore.value = false
    mockLoadMore.mockReset()
    mockFetchFavSegments.mockReset()
  })

  it('renders loading state when pending without data', () => {
    mockDetailRes.value = undefined
    mockPending.value = true
    const wrapper = createWrapper()
    expect(wrapper.find('.loading-container').exists()).toBe(true)
    expect(wrapper.find('.dot-pulse-mock').exists()).toBe(true)
  })

  it('renders unit title and description from async data', () => {
    const wrapper = createWrapper()
    expect(wrapper.text()).toContain('测试单元')
    expect(wrapper.text()).toContain('这是一个测试单元的描述')
  })

  it('renders segment cards with correct titles', () => {
    const wrapper = createWrapper()
    expect(wrapper.text()).toContain('片段一')
    expect(wrapper.text()).toContain('片段二')
  })

  it('renders phase dots with correct states', () => {
    const wrapper = createWrapper()
    const cards = wrapper.findAll('.segment-card')
    expect(cards.length).toBe(2)
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

  it('renders all done for fully completed segment', () => {
    const wrapper = createWrapper()
    const cards = wrapper.findAll('.segment-card')
    const secondCardPhases = cards[1]!.findAll('.phase-dot')
    secondCardPhases.forEach((dot) => {
      expect(dot.classes()).toContain('phase-dot--done')
    })
  })

  it('shows empty state when no segments', () => {
    mockDetailRes.value = {
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
    }
    const wrapper = createWrapper()
    expect(wrapper.find('.empty-state').exists()).toBe(true)
    expect(wrapper.text()).toContain('暂无片段数据')
  })

  it('shows error state when API returns non-200 (page-level, no toast)', () => {
    mockDetailRes.value = { code: 500, message: '服务器错误', data: null }
    const wrapper = createWrapper()
    expect(wrapper.find('.error-container').exists()).toBe(true)
    expect(wrapper.text()).toContain('服务器错误')
    expect(wrapper.find('.retry-btn').exists()).toBe(true)
  })

  it('shows network error and retry calls refresh', async () => {
    mockDetailRes.value = undefined
    mockFetchError.value = new Error('timeout')
    const wrapper = createWrapper()
    expect(wrapper.text()).toContain('加载失败，请检查网络')
    await wrapper.find('.retry-btn').trigger('click')
    expect(mockRefresh).toHaveBeenCalled()
  })

  it('links to correct segment pages', () => {
    const wrapper = createWrapper()
    const cards = wrapper.findAll('.segment-card')
    expect(cards[0]!.find('.segment-card__link').attributes('href')).toBe('/learn/unit/1/segment/1')
    expect(cards[1]!.find('.segment-card__link').attributes('href')).toBe('/learn/unit/1/segment/2')
  })

  it('marks own segments with badge and highlight', () => {
    const wrapper = createWrapper()
    const cards = wrapper.findAll('.segment-card')
    // 片段一 isMine=true → 高亮类 + 「我的」角标
    expect(cards[0]!.classes()).toContain('segment-card--mine')
    expect(cards[0]!.find('.segment-card__badge').exists()).toBe(true)
    expect(cards[0]!.find('.segment-card__badge').text()).toBe('我的')
    // 片段二 isMine=false → 无高亮与角标
    expect(cards[1]!.classes()).not.toContain('segment-card--mine')
    expect(cards[1]!.find('.segment-card__badge').exists()).toBe(false)
  })

  it('logged-in user: fetches favorites and shows fav buttons', () => {
    const wrapper = createWrapper()
    expect(mockFetchFavSegments).toHaveBeenCalled()
    expect(wrapper.findAll('.segment-fav-btn').length).toBe(2)
  })

  it('guest: no favorites request and no fav buttons', () => {
    mockUserStore.isLogin = false
    const wrapper = createWrapper()
    expect(mockFetchFavSegments).not.toHaveBeenCalled()
    expect(wrapper.findAll('.segment-fav-btn').length).toBe(0)
    // 内容仍可浏览（裁剪版）
    expect(wrapper.text()).toContain('测试单元')
  })
})
