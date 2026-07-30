/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SignJWT } from 'jose'
import { signGuestToken, verifyGuestToken, readGuestKey } from '../guest'

// 固定测试密钥，mock 掉 #server/utils/auth 的 getSecret（避免 useRuntimeConfig 崩溃）
const TEST_SECRET = new TextEncoder().encode('guest-test-secret-guest-test-secret')
vi.mock('#server/utils/auth', () => ({ getSecret: () => TEST_SECRET }))

// h3 自动导入的 cookie 函数：node 环境手动挂全局
const cookieStore = vi.hoisted(() => ({ current: {} as Record<string, string | undefined> }))
;(globalThis as any).getCookie = (_event: any, name: string) => cookieStore.current[name]

beforeEach(() => {
  cookieStore.current = {}
})

describe('signGuestToken / verifyGuestToken', () => {
  it('签发→验签往返返回同一 gk', async () => {
    const token = await signGuestToken('key-123')
    const payload = await verifyGuestToken(token)
    expect(payload.gk).toBe('key-123')
    expect(payload.typ).toBe('guest')
  })

  it('拒绝用户 token 冒充（无 typ:guest）', async () => {
    // 同密钥签发一个用户风格 token（无 typ）
    const userToken = await new SignJWT({ id: 5, role: 0 })
      .setProtectedHeader({ alg: 'HS256' })
      .sign(TEST_SECRET)
    await expect(verifyGuestToken(userToken)).rejects.toThrow()
  })

  it('拒绝 gk 缺失的游客 token', async () => {
    const bad = await new SignJWT({ typ: 'guest' })
      .setProtectedHeader({ alg: 'HS256' })
      .sign(TEST_SECRET)
    await expect(verifyGuestToken(bad)).rejects.toThrow()
  })

  it('篡改/非法 token 验签抛错', async () => {
    await expect(verifyGuestToken('not-a-jwt')).rejects.toThrow()
  })
})

describe('readGuestKey', () => {
  it('有效 cookie → 返回 gk', async () => {
    cookieStore.current.guest_token = await signGuestToken('abc')
    const key = await readGuestKey({} as any)
    expect(key).toBe('abc')
  })

  it('无 cookie → null', async () => {
    const key = await readGuestKey({} as any)
    expect(key).toBeNull()
  })

  it('坏 token → 静默 null（不抛错）', async () => {
    cookieStore.current.guest_token = 'garbage'
    const key = await readGuestKey({} as any)
    expect(key).toBeNull()
  })

  it('用户 token 塞进 guest cookie → 静默 null', async () => {
    cookieStore.current.guest_token = await new SignJWT({ id: 1, role: 0 })
      .setProtectedHeader({ alg: 'HS256' })
      .sign(TEST_SECRET)
    const key = await readGuestKey({} as any)
    expect(key).toBeNull()
  })
})
