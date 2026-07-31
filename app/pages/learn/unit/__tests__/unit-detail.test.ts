import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
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

// Mock useUnitProgress（首屏 + 分页均来自同一 composable）
const mockIsLoadingMore = ref(false)
const mockLoadMore = vi.fn()
const mockExecute = vi.fn()
vi.mock('~/composables/unit/useUnitProgress', () => ({
  useUnitProgress: () => ({
    isLoading: ref(false),
    isLoadingMore: mockIsLoadingMore,
    execute: mockExecute,
    loadMore: mockLoadMore,
  }),
}))

// useGuestStudyTimer 为显式 import（非自动导入），mock 掉避免真实计时器副作用
vi.mock('~/composables/user/useGuestStudyTimer', () => ({ useGuestStudyTimer: vi.fn() }))

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
vi.stubGlobal('useSeoMeta', vi.fn())
vi.stubGlobal('useJsonLd', vi.fn())
const mockNavigateTo = vi.fn()
vi.stubGlobal('navigateTo', mockNavigateTo)
vi.stubGlobal(
  'learningResourceSchema',
  vi.fn(() => ({})),
)
vi.stubGlobal(
  'IntersectionObserver',
  class {
    observe = observeSpy
    unobserve = unobserveSpy
    disconnect = vi.fn()
  },
)
const { observeSpy, unobserveSpy } = vi.hoisted(() => ({
  observeSpy: vi.fn(),
  unobserveSpy: vi.fn(),
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

async function createWrapper() {
  const wrapper = mount(UnitDetail, {
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
  // 等待 onMounted 中的 loadData 异步完成
  await flushPromises()
  mountedWrappers.push(wrapper)
  return wrapper
}

// 共享响应式 mock 下残留组件的 watcher 会污染 observe spy，用例间统一卸载隔离
const mountedWrappers: Array<Awaited<ReturnType<typeof createWrapper>>> = []

describe('UnitDetail Page', () => {
  beforeEach(() => {
    mockUserStore.isLogin = true
    mockExecute.mockImplementation(() => Promise.resolve(mockSuccessData))
    mockIsLoadingMore.value = false
    mockLoadMore.mockReset()
    mockFetchFavSegments.mockReset()
    mockNavigateTo.mockReset()
    observeSpy.mockClear()
    unobserveSpy.mockClear()
  })

  afterEach(() => {
    while (mountedWrappers.length) mountedWrappers.pop()!.unmount()
  })

  it('renders loading state when data not yet available', async () => {
    // 模拟加载中：execute 返回永不 resolve 的 Promise，isLoadingMore 撑住骨架屏
    mockExecute.mockImplementation(() => new Promise(() => {}))
    mockIsLoadingMore.value = true
    const wrapper = mount(UnitDetail, {
      global: {
        stubs: {
          NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' },
          'el-icon': { template: '<span class="el-icon-stub"><slot /></span>' },
          DotPulse: { template: '<div class="dot-pulse-mock">Loading...</div>' },
        },
      },
    })
    expect(wrapper.find('.loading-container').exists()).toBe(true)
    expect(wrapper.find('.dot-pulse-mock').exists()).toBe(true)
    wrapper.unmount()
  })

  it('renders unit title and description from async data', async () => {
    const wrapper = await createWrapper()
    expect(wrapper.text()).toContain('测试单元')
    expect(wrapper.text()).toContain('这是一个测试单元的描述')
  })

  it('renders segment cards with correct titles', async () => {
    const wrapper = await createWrapper()
    expect(wrapper.text()).toContain('片段一')
    expect(wrapper.text()).toContain('片段二')
  })

  it('renders phase dots with correct states', async () => {
    const wrapper = await createWrapper()
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

  it('renders all done for fully completed segment', async () => {
    const wrapper = await createWrapper()
    const cards = wrapper.findAll('.segment-card')
    const secondCardPhases = cards[1]!.findAll('.phase-dot')
    secondCardPhases.forEach((dot) => {
      expect(dot.classes()).toContain('phase-dot--done')
    })
  })

  it('renders phase connector lines with done states', async () => {
    const wrapper = await createWrapper()
    const cards = wrapper.findAll('.segment-card')
    // 每卡 4 个圆点之间 3 条连接线
    const firstLines = cards[0]!.findAll('.phase-line')
    expect(firstLines.length).toBe(3)
    // 片段一仅 phase1 完成 → 所有连接线右侧阶段均未完成，无 done 态
    firstLines.forEach((line) => {
      expect(line.classes()).not.toContain('phase-line--done')
    })
    // 片段二全完成 → 连接线全部 done
    const secondLines = cards[1]!.findAll('.phase-line')
    secondLines.forEach((line) => {
      expect(line.classes()).toContain('phase-line--done')
    })
  })

  it('renders best score chips only when scores exist', async () => {
    const wrapper = await createWrapper()
    const cards = wrapper.findAll('.segment-card')
    // 片段一无成绩 → 无 chip
    expect(cards[0]!.findAll('.score-chip').length).toBe(0)
    // 片段二有双阶段成绩 → 两个 chip
    const chips = cards[1]!.findAll('.score-chip')
    expect(chips.length).toBe(2)
    expect(chips[0]!.text()).toContain('配音 85 分')
    expect(chips[1]!.text()).toContain('跟读 90 分')
  })

  it('leaderboard button navigates to leaderboard page', async () => {
    const wrapper = await createWrapper()
    const cards = wrapper.findAll('.segment-card')
    const btn = cards[0]!.find('.segment-lb-btn')
    expect(btn.exists()).toBe(true)
    await btn.trigger('click')
    expect(mockNavigateTo).toHaveBeenCalledWith('/learn/unit/1/segment/1/leaderboard')
  })

  it('shows empty state when no segments', async () => {
    const emptyData = {
      code: 200,
      message: 'ok',
      data: {
        unit: { id: 1, title: '测试单元', description: null, level: 1, sortOrder: 1, audioUrl: null },
        segments: [],
        pagination: { page: 1, pageSize: 10, total: 0, hasMore: false },
      },
    }
    mockExecute.mockImplementation(() => Promise.resolve(emptyData))
    const wrapper = await createWrapper()
    expect(wrapper.find('.empty-state').exists()).toBe(true)
    expect(wrapper.text()).toContain('暂无片段数据')
  })

  it('shows error state when API returns non-200 (page-level, no toast)', async () => {
    const errorRes = { code: 500, message: '服务器错误', data: null }
    mockExecute.mockImplementation(() => Promise.resolve(errorRes))
    const wrapper = await createWrapper()
    expect(wrapper.find('.error-container').exists()).toBe(true)
    expect(wrapper.text()).toContain('服务器错误')
    expect(wrapper.find('.retry-btn').exists()).toBe(true)
  })

  it('retry button calls loadData again', async () => {
    const errorRes = { code: 500, message: '服务器错误', data: null }
    mockExecute.mockImplementation(() => Promise.resolve(errorRes))
    const wrapper = await createWrapper()
    expect(wrapper.find('.error-container').exists()).toBe(true)
    // 重置 mock 改为成功返回
    mockExecute.mockImplementation(() => Promise.resolve(mockSuccessData))
    await wrapper.find('.retry-btn').trigger('click')
    await flushPromises()
    expect(wrapper.find('.error-container').exists()).toBe(false)
    expect(wrapper.text()).toContain('测试单元')
  })

  it('observer binds sentinel after data arrives (client navigation)', async () => {
    // 客户端导航：onMounted 触发 loadData，flushPromises 后数据到达，sentinel 渲染
    const wrapper = await createWrapper()
    expect(wrapper.find('.sentinel').exists()).toBe(true)
    expect(observeSpy).toHaveBeenCalled()
    const observed = observeSpy.mock.calls[0]![0] as HTMLElement
    expect(observed.className).toContain('sentinel')
  })

  it('links to correct segment pages', async () => {
    const wrapper = await createWrapper()
    const cards = wrapper.findAll('.segment-card')
    expect(cards[0]!.find('.segment-card__link').attributes('href')).toBe('/learn/unit/1/segment/1')
    expect(cards[1]!.find('.segment-card__link').attributes('href')).toBe('/learn/unit/1/segment/2')
  })

  it('marks own segments with badge and highlight', async () => {
    const wrapper = await createWrapper()
    const cards = wrapper.findAll('.segment-card')
    // 片段一 isMine=true → 高亮类 + 「我的」角标
    expect(cards[0]!.classes()).toContain('segment-card--mine')
    expect(cards[0]!.find('.segment-card__badge').exists()).toBe(true)
    expect(cards[0]!.find('.segment-card__badge').text()).toBe('我的')
    // 片段二 isMine=false → 无高亮与角标
    expect(cards[1]!.classes()).not.toContain('segment-card--mine')
    expect(cards[1]!.find('.segment-card__badge').exists()).toBe(false)
  })

  it('logged-in user: fetches favorites and shows fav buttons', async () => {
    const wrapper = await createWrapper()
    expect(mockFetchFavSegments).toHaveBeenCalled()
    expect(wrapper.findAll('.segment-fav-btn').length).toBe(2)
  })

  it('guest: no favorites request but fav buttons still visible (dimmed)', async () => {
    mockUserStore.isLogin = false
    const wrapper = await createWrapper()
    // 游客不发收藏请求（避免 401）
    expect(mockFetchFavSegments).not.toHaveBeenCalled()
    // 收藏按钮仍可见（带 guest 淡化类），点击时温和提示登录
    const favBtns = wrapper.findAll('.segment-fav-btn')
    expect(favBtns.length).toBe(2)
    expect(favBtns[0]!.classes()).toContain('segment-fav-btn--guest')
    // 内容仍可浏览
    expect(wrapper.text()).toContain('测试单元')
  })
})
