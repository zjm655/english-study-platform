import { describe, it, expect } from 'vitest'
import {
  passwordChangeSchema,
  userProfileUpdateSchema,
  loginSchema,
  registerSchema,
} from '../validate'

/** 取第一条校验错误消息，便于断言文案 */
function firstMessage(parsed: { success: boolean; error?: { issues: { message: string }[] } }) {
  return parsed.success ? undefined : parsed.error?.issues?.[0]?.message
}

describe('passwordChangeSchema（修改密码校验）', () => {
  it('新密码长度不足 8 位应被拒绝', () => {
    const parsed = passwordChangeSchema.safeParse({
      oldPassword: 'old12345!',
      newPassword: 'a1b2c3',
      confirmPassword: 'a1b2c3',
    })
    expect(parsed.success).toBe(false)
    expect(firstMessage(parsed)).toBe('密码长度不能少于8位')
  })

  it('新密码超过 25 位应被拒绝', () => {
    const long = 'a1'.repeat(13) // 26 位
    const parsed = passwordChangeSchema.safeParse({
      oldPassword: 'old12345!',
      newPassword: long,
      confirmPassword: long,
    })
    expect(parsed.success).toBe(false)
    expect(firstMessage(parsed)).toBe('密码长度不能超过25位')
  })

  it('新密码只有一类字符（纯数字）应被拒绝', () => {
    const parsed = passwordChangeSchema.safeParse({
      oldPassword: 'old12345!',
      newPassword: '12345678',
      confirmPassword: '12345678',
    })
    expect(parsed.success).toBe(false)
    expect(firstMessage(parsed)).toBe('密码必须包含数字、字母、特殊符号中的至少两类')
  })

  it('新密码只有一类字符（纯字母）应被拒绝', () => {
    const parsed = passwordChangeSchema.safeParse({
      oldPassword: 'old12345!',
      newPassword: 'abcdefgh',
      confirmPassword: 'abcdefgh',
    })
    expect(parsed.success).toBe(false)
    expect(firstMessage(parsed)).toBe('密码必须包含数字、字母、特殊符号中的至少两类')
  })

  it('两次密码不一致应被拒绝且 path 指向 confirmPassword', () => {
    const parsed = passwordChangeSchema.safeParse({
      oldPassword: 'old12345!',
      newPassword: 'new12345!',
      confirmPassword: 'new12345?',
    })
    expect(parsed.success).toBe(false)
    if (!parsed.success) {
      expect(parsed.error.issues[0]?.message).toBe('两次密码输入不一致')
      expect(parsed.error.issues[0]?.path).toEqual(['confirmPassword'])
    }
  })

  it('新旧密码相同应被拒绝且 path 指向 newPassword', () => {
    const parsed = passwordChangeSchema.safeParse({
      oldPassword: 'same12345!',
      newPassword: 'same12345!',
      confirmPassword: 'same12345!',
    })
    expect(parsed.success).toBe(false)
    if (!parsed.success) {
      expect(parsed.error.issues[0]?.message).toBe('新密码不能与旧密码相同')
      expect(parsed.error.issues[0]?.path).toEqual(['newPassword'])
    }
  })

  it('oldPassword 为空应被拒绝', () => {
    const parsed = passwordChangeSchema.safeParse({
      oldPassword: '',
      newPassword: 'new12345!',
      confirmPassword: 'new12345!',
    })
    expect(parsed.success).toBe(false)
  })

  it('合法输入应通过（字母+数字两类）', () => {
    const parsed = passwordChangeSchema.safeParse({
      oldPassword: 'old12345!',
      newPassword: 'abc12345',
      confirmPassword: 'abc12345',
    })
    expect(parsed.success).toBe(true)
  })

  it('合法输入应通过（数字+特殊符号两类）', () => {
    const parsed = passwordChangeSchema.safeParse({
      oldPassword: 'old12345!',
      newPassword: '1234!@#$',
      confirmPassword: '1234!@#$',
    })
    expect(parsed.success).toBe(true)
  })
})

describe('userProfileUpdateSchema（修改昵称校验）', () => {
  it('空昵称应被拒绝', () => {
    const parsed = userProfileUpdateSchema.safeParse({ nickname: '' })
    expect(parsed.success).toBe(false)
    expect(firstMessage(parsed)).toBe('昵称不能为空')
  })

  it('纯空白昵称 trim 后为空应被拒绝', () => {
    const parsed = userProfileUpdateSchema.safeParse({ nickname: '   ' })
    expect(parsed.success).toBe(false)
  })

  it('超过 25 字应被拒绝', () => {
    const parsed = userProfileUpdateSchema.safeParse({ nickname: '甲'.repeat(26) })
    expect(parsed.success).toBe(false)
    expect(firstMessage(parsed)).toBe('昵称最多25个字符')
  })

  it('合法昵称应通过且首尾空白被 trim', () => {
    const parsed = userProfileUpdateSchema.safeParse({ nickname: '  小明  ' })
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data.nickname).toBe('小明')
  })

  it('恰好 25 字应通过', () => {
    const parsed = userProfileUpdateSchema.safeParse({ nickname: 'a'.repeat(25) })
    expect(parsed.success).toBe(true)
  })
})

// 回归：提取共享密码规则 passwordSchema 后，loginSchema/registerSchema 行为不变
describe('loginSchema（共享密码规则提取回归）', () => {
  it('合法账号密码应通过', () => {
    const parsed = loginSchema.safeParse({ account: '12345678', password: 'abc12345' })
    expect(parsed.success).toBe(true)
  })

  it('单类字符密码应被拒绝且文案不变', () => {
    const parsed = loginSchema.safeParse({ account: '12345678', password: '12345678' })
    expect(parsed.success).toBe(false)
    expect(firstMessage(parsed)).toBe('密码必须包含数字、字母、特殊符号中的至少两类')
  })
})

describe('registerSchema（共享密码规则提取回归）', () => {
  const base = {
    account: '12345678',
    captchaToken: 'tk',
    captchaCode: 'code',
  }

  it('合法注册参数应通过', () => {
    const parsed = registerSchema.safeParse({
      ...base,
      password1: 'abc12345',
      password2: 'abc12345',
    })
    expect(parsed.success).toBe(true)
  })

  it('password1 长度不足应被拒绝且文案不变', () => {
    const parsed = registerSchema.safeParse({
      ...base,
      password1: 'a1b2',
      password2: 'a1b2c3d4',
    })
    expect(parsed.success).toBe(false)
    expect(firstMessage(parsed)).toBe('密码长度不能少于8位')
  })
})
