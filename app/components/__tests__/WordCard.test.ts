/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import WordCard from '../WordCard.vue'

// Mock 音频链路（避免真实 Howler/网络）；共享实例供断言
const { mockLoad, mockPlay, mockResolveGuestAudioUrl } = vi.hoisted(() => ({
  mockLoad: vi.fn(),
  mockPlay: vi.fn(),
  mockResolveGuestAudioUrl: vi.fn().mockResolvedValue('https://signed-url.example/word.mp3'),
}))
vi.mock('~/composables/media/useAudioPlayer', () => ({
  useAudioPlayer: () => ({ load: mockLoad, play: mockPlay }),
}))
vi.mock('~/composables/media/useGuestAudio', () => ({
  resolveGuestAudioUrl: mockResolveGuestAudioUrl,
}))
vi.mock('~/utils/popup', () => ({ toastError: vi.fn() }))

function makeVocab(overrides: Record<string, any> = {}) {
  return {
    id: 1,
    word: 'bedroom',
    forms: 'bedrooms',
    phonetic: '/ˈbedruːm/',
    meaning: '卧室',
    audioUrl: 'https://oss.example/bedroom.mp3',
    audioObjectKey: undefined,
    duration: 1.2,
    ...overrides,
  }
}

function mountCard(props: Record<string, any> = {}) {
  return mount(WordCard as any, {
    props: {
      vocab: makeVocab(),
      favActive: false,
      ...props,
    },
  })
}

describe('WordCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders word, phonetic, meaning and forms', () => {
    const wrapper = mountCard()
    expect(wrapper.find('.vocab-word').text()).toBe('bedroom')
    expect(wrapper.find('.vocab-phonetic').text()).toBe('/ˈbedruːm/')
    expect(wrapper.find('.vocab-meaning').text()).toBe('卧室')
    expect(wrapper.find('.vocab-forms').text()).toContain('bedrooms')
  })

  it('omits phonetic/forms when absent', () => {
    const wrapper = mountCard({ vocab: makeVocab({ phonetic: null, forms: null }) })
    expect(wrapper.find('.vocab-phonetic').exists()).toBe(false)
    expect(wrapper.find('.vocab-forms').exists()).toBe(false)
  })

  it('emits toggle-fav when fav button clicked', async () => {
    const wrapper = mountCard()
    await wrapper.find('.fav-btn').trigger('click')
    expect(wrapper.emitted('toggle-fav')).toHaveLength(1)
  })

  it('applies active class when favorited', () => {
    const wrapper = mountCard({ favActive: true })
    expect(wrapper.find('.fav-btn').classes()).toContain('fav-btn--active')
  })

  it('shows audio button only when audio available', () => {
    const withAudio = mountCard()
    expect(withAudio.find('.audio-btn').exists()).toBe(true)
    const withoutAudio = mountCard({ vocab: makeVocab({ audioUrl: null, audioObjectKey: null }) })
    expect(withoutAudio.find('.audio-btn').exists()).toBe(false)
  })

  it('plays audio via resolved signed URL', async () => {
    const wrapper = mountCard()
    await wrapper.find('.audio-btn').trigger('click')
    await flushPromises()
    expect(mockResolveGuestAudioUrl).toHaveBeenCalledWith(
      'https://oss.example/bedroom.mp3',
      undefined,
      'word',
    )
    expect(mockLoad).toHaveBeenCalledWith('https://signed-url.example/word.mp3')
    expect(mockPlay).toHaveBeenCalled()
  })

  it('disables fav button when favDisabled', () => {
    const wrapper = mountCard({ favDisabled: true })
    expect(wrapper.find('.fav-btn').attributes('disabled')).toBeDefined()
  })
})
