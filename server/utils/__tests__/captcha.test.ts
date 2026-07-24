import { describe, it, expect, vi } from 'vitest'

import { generateCaptcha, verifyCaptcha } from '../captcha'

// captcha 依赖 useRuntimeConfig().jwtSecret（经 getSecret 与 hashCode），node 测试需 stub。
// captcha.ts 仅在函数调用时读取 useRuntimeConfig（非模块加载时），故 stub 在 import 后设置即可生效。
vi.stubGlobal('useRuntimeConfig', () => ({ jwtSecret: 'test-secret-for-captcha-unit' }))

/** 从 SVG 的 <text> 元素中还原验证码字符串（用于端到端校验，不暴露明文接口） */
function extractCode(svg: string): string {
  return [...svg.matchAll(/<text[^>]*>([^<]+)<\/text>/g)].map((m) => m[1]).join('')
}

describe('captcha - 生成', () => {
  it('返回 SVG 图与三段式 JWT token', async () => {
    const { svg, token } = await generateCaptcha()
    expect(svg).toContain('<svg')
    expect(svg).toContain('</svg>')
    expect(token.split('.')).toHaveLength(3)
  })

  it('验证码为 4 位字符', async () => {
    const { svg } = await generateCaptcha()
    expect(extractCode(svg)).toHaveLength(4)
  })
})

describe('captcha - 校验', () => {
  it('正确验证码通过（大小写不敏感）', async () => {
    const { svg, token } = await generateCaptcha()
    const code = extractCode(svg)
    expect(await verifyCaptcha(token, code)).toBe(true)
    expect(await verifyCaptcha(token, code.toLowerCase())).toBe(true)
  })

  it('错误验证码不通过', async () => {
    const { token } = await generateCaptcha()
    expect(await verifyCaptcha(token, 'WRONGCODE')).toBe(false)
  })

  it('空 token 或空输入不通过', async () => {
    const { svg, token } = await generateCaptcha()
    const code = extractCode(svg)
    expect(await verifyCaptcha('', code)).toBe(false)
    expect(await verifyCaptcha(token, '')).toBe(false)
  })

  it('篡改/非法 token 不抛异常且不通过', async () => {
    const { svg } = await generateCaptcha()
    const code = extractCode(svg)
    expect(await verifyCaptcha('a.b.c', code)).toBe(false)
    expect(await verifyCaptcha('not-a-jwt', code)).toBe(false)
  })
})
