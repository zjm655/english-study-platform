import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import GraphicCaptcha from '../GraphicCaptcha.vue'

// GraphicCaptcha 依赖 useCaptcha（内部用 Nuxt 自动导入的 createResCfg/useHandleRes，测试环境无），整体 mock。
// mockExecute 经 vi.hoisted 提升，供被提升的 vi.mock 工厂引用
const { mockExecute } = vi.hoisted(() => ({ mockExecute: vi.fn() }))
vi.mock('~/composables/user', () => ({
  useCaptcha: () => ({ isLoading: ref(false), execute: mockExecute }),
}))

// el-input 在测试环境未全局注册，用最小 stub 承载 v-model
const ElInput = {
  name: 'ElInput',
  props: ['modelValue', 'placeholder'],
  emits: ['update:modelValue'],
  template: `<input class="el-input" :value="modelValue" @input="$emit('update:modelValue', $event.target.value)" />`,
}

function mountCaptcha() {
  return mount(GraphicCaptcha, { global: { components: { ElInput } } })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockExecute.mockResolvedValue({ code: 200, data: { svg: '<svg>x</svg>', token: 'tok-123' } })
})

describe('GraphicCaptcha', () => {
  it('挂载即拉取验证码并以 <img> data URI 渲染', async () => {
    const wrapper = mountCaptcha()
    await flushPromises()
    expect(mockExecute).toHaveBeenCalledTimes(1)
    const img = wrapper.find('img')
    expect(img.exists()).toBe(true)
    expect(img.attributes('src')).toContain('data:image/svg+xml')
  })

  it('拉取成功后通过 v-model:token 上抛 token', async () => {
    const wrapper = mountCaptcha()
    await flushPromises()
    expect(wrapper.emitted('update:token')?.at(-1)).toEqual(['tok-123'])
  })

  it('点击图片区域刷新（再次拉取验证码）', async () => {
    const wrapper = mountCaptcha()
    await flushPromises()
    mockExecute.mockClear()
    await wrapper.find('.graphic-captcha__img').trigger('click')
    await flushPromises()
    expect(mockExecute).toHaveBeenCalledTimes(1)
  })

  it('输入内容通过 v-model:code 上抛', async () => {
    const wrapper = mountCaptcha()
    await flushPromises()
    await wrapper.find('input.el-input').setValue('abcd')
    expect(wrapper.emitted('update:code')?.at(-1)).toEqual(['abcd'])
  })

  it('刷新时清空已输入的 code', async () => {
    const wrapper = mountCaptcha()
    await flushPromises()
    await wrapper.find('input.el-input').setValue('abcd')
    await wrapper.find('.graphic-captcha__img').trigger('click')
    await flushPromises()
    // refresh 内 code.value = '' → 最后一次上抛为空串
    expect(wrapper.emitted('update:code')?.at(-1)).toEqual([''])
  })
})
