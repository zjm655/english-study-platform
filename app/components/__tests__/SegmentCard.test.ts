/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import SegmentCard from '../SegmentCard.vue'

// 构造测试用片段数据
function makeSegment(overrides: Record<string, any> = {}) {
  return {
    id: 1,
    title: '测试片段',
    audioUrl: null,
    sortOrder: 1,
    isMine: false,
    progress: {
      phase1_done: true,
      phase2_done: false,
      phase3_done: false,
      phase3_score: null,
      phase4_done: false,
      phase4_score: null,
      updatedAt: null,
    },
    ...overrides,
  }
}

function mountCard(props: Record<string, any> = {}) {
  return mount(SegmentCard as any, {
    props: {
      segment: makeSegment(),
      unitId: 1,
      favActive: false,
      ...props,
    },
    global: {
      stubs: {
        NuxtLink: {
          props: ['to'],
          template: '<a :href="to"><slot /></a>',
        },
        'el-icon': {
          template: '<span class="el-icon-stub"><slot /></span>',
        },
      },
    },
  })
}

describe('SegmentCard', () => {
  it('renders segment title and link to learning page', () => {
    const wrapper = mountCard()
    expect(wrapper.find('.segment-card__title').text()).toBe('测试片段')
    expect(wrapper.find('.segment-card__link').attributes('href')).toBe('/learn/unit/1/segment/1')
  })

  it('renders phase dots with done/current states', () => {
    const wrapper = mountCard()
    const dots = wrapper.findAll('.phase-dot')
    expect(dots.length).toBe(4)
    // phase1 done → 完成态
    expect(dots[0]!.classes()).toContain('phase-dot--done')
    // phase2 未完成且是下一个 → 当前态
    expect(dots[1]!.classes()).toContain('phase-dot--current')
    // 连线 done 取决于其后的 dot：第一条 line（phase2 前）未完成，后续（phase3/4 前）均未完成
    const lines = wrapper.findAll('.phase-line')
    expect(lines.length).toBe(3)
    expect(lines[0]!.classes()).not.toContain('phase-line--done')
  })

  it('renders score chips when scores exist', () => {
    const wrapper = mountCard({
      segment: makeSegment({
        progress: {
          phase1_done: true,
          phase2_done: true,
          phase3_done: true,
          phase3_score: 85,
          phase4_done: true,
          phase4_score: 90,
        },
      }),
    })
    const chips = wrapper.findAll('.score-chip')
    expect(chips.length).toBe(2)
    expect(chips[0]!.text()).toContain('配音 85 分')
    expect(chips[1]!.text()).toContain('跟读 90 分')
  })

  it('marks own segments with badge and highlight', () => {
    const wrapper = mountCard({ segment: makeSegment({ isMine: true }) })
    expect(wrapper.classes()).toContain('segment-card--mine')
    expect(wrapper.find('.segment-card__badge').text()).toBe('我的')
  })

  it('emits toggle-fav when fav button clicked', async () => {
    const wrapper = mountCard()
    await wrapper.find('.segment-fav-btn').trigger('click')
    expect(wrapper.emitted('toggle-fav')).toHaveLength(1)
  })

  it('applies active/guest classes to fav button', () => {
    const active = mountCard({ favActive: true })
    expect(active.find('.segment-fav-btn').classes()).toContain('segment-fav-btn--active')
    const guest = mountCard({ guest: true })
    expect(guest.find('.segment-fav-btn').classes()).toContain('segment-fav-btn--guest')
  })

  it('emits go-leaderboard and open-words from action buttons', async () => {
    const wrapper = mountCard()
    await wrapper.find('.segment-lb-btn').trigger('click')
    expect(wrapper.emitted('go-leaderboard')).toHaveLength(1)
    await wrapper.find('.segment-words-btn').trigger('click')
    expect(wrapper.emitted('open-words')).toHaveLength(1)
  })

  it('hides action row when showExtras=false', () => {
    const wrapper = mountCard({ showExtras: false })
    expect(wrapper.find('.segment-card__footer').exists()).toBe(false)
  })

  it('disables fav button when favDisabled', () => {
    const wrapper = mountCard({ favDisabled: true })
    expect(wrapper.find('.segment-fav-btn').attributes('disabled')).toBeDefined()
  })
})
