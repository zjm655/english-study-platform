import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import LoginPage from '../index.vue'

// —— Nuxt 自动导入（测试环境无）——
vi.stubGlobal('useSeoMeta', () => {})
const navigateToMock = vi.fn()
vi.stubGlobal('navigateTo', navigateToMock)

// —— 业务 Hook：登录/注册均 stub；mock fn 经 vi.hoisted 提升供被提升的 vi.mock 工厂引用 ——
const { mockHandleLogin, mockRegisterExecute } = vi.hoisted(() => ({
  mockHandleLogin: vi.fn(),
  mockRegisterExecute: vi.fn(),
}))
vi.mock('~/composables/user', () => ({
  useToLogin: () => ({ isLoading: ref(false), handleLogin: mockHandleLogin, execute: vi.fn() }),
  useToRegister: () => ({ isLoading: ref(false), execute: mockRegisterExecute }),
}))

// el-form 表单校验结果由 mockValidate 控制（模拟“规则通过/不通过”）
const mockValidate = vi.fn(() => Promise.resolve(true))

// —— 最小 stub：验证码组件 + Element Plus 组件 ——
const GraphicCaptcha = {
  name: 'GraphicCaptcha',
  template: '<div class="mock-captcha"></div>',
  methods: { refresh() {} },
}
const ElTabs = { props: ['modelValue'], template: '<div class="el-tabs"><slot /></div>' }
const ElTabPane = { props: ['label', 'name'], template: '<div class="el-tab-pane"><slot /></div>' }
const ElForm = {
  template: '<form class="el-form"><slot /></form>',
  methods: {
    validate() {
      return mockValidate()
    },
    resetFields() {},
    validateField() {},
  },
}
const ElFormItem = {
  props: ['label', 'prop'],
  template: '<div class="el-form-item"><slot /></div>',
}
const ElInput = {
  props: ['modelValue'],
  emits: ['update:modelValue'],
  template: `<input class="el-input" :value="modelValue" @input="$emit('update:modelValue', $event.target.value)" />`,
}
const ElButton = {
  emits: ['click'],
  template: `<button class="el-button" @click="$emit('click')"><slot /></button>`,
}

function mountLogin() {
  return mount(LoginPage, {
    global: {
      components: {
        GraphicCaptcha,
        ElTabs,
        ElTabPane,
        ElForm,
        ElFormItem,
        ElInput,
        ElButton,
      },
    },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockValidate.mockResolvedValue(true)
})

describe('登录页 - 验证码显隐（428 信号）', () => {
  it('常态登录不显示验证码；注册区始终有验证码', () => {
    const wrapper = mountLogin()
    // 登录区验证码 v-if=false → 隐藏；注册区验证码常驻 → 全页恰有 1 个
    expect(wrapper.findAll('.mock-captcha')).toHaveLength(1)
  })

  it('登录返回 428 后显示登录验证码', async () => {
    mockHandleLogin.mockResolvedValue({ code: 428, message: '请输入图形验证码' })
    const wrapper = mountLogin()
    // 点击登录提交按钮（.submit-btn 有登录、注册两个，取第一个=登录）
    await wrapper.findAll('.submit-btn')[0]!.trigger('click')
    await flushPromises()
    // 登录验证码显现 → 全页 2 个（登录 + 注册）
    expect(wrapper.findAll('.mock-captcha')).toHaveLength(2)
  })

  it('登录成功跳转首页', async () => {
    mockHandleLogin.mockResolvedValue({ code: 200, data: { id: 1 } })
    const wrapper = mountLogin()
    await wrapper.findAll('.submit-btn')[0]!.trigger('click')
    await flushPromises()
    expect(navigateToMock).toHaveBeenCalledWith('/')
  })
})

describe('登录页 - 注册验证码校验', () => {
  it('校验不通过时不提交注册', async () => {
    mockValidate.mockResolvedValue(false)
    const wrapper = mountLogin()
    await wrapper.findAll('.submit-btn')[1]!.trigger('click')
    await flushPromises()
    expect(mockRegisterExecute).not.toHaveBeenCalled()
  })

  it('校验通过时提交注册，且携带验证码字段', async () => {
    mockRegisterExecute.mockResolvedValue({ code: 200 })
    const wrapper = mountLogin()
    await wrapper.findAll('.submit-btn')[1]!.trigger('click')
    await flushPromises()
    expect(mockRegisterExecute).toHaveBeenCalledTimes(1)
    const payload = mockRegisterExecute.mock.calls[0]![0]
    expect(payload).toHaveProperty('captchaToken')
    expect(payload).toHaveProperty('captchaCode')
  })
})
