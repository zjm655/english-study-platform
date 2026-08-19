import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mapAdminModerationEnabled, getAdminModerationEnabled } from '../moderationConfig'

// 配置读取已接入 configStore（模块内不再自建缓存），mock getSysConfigKeys 返回固定 Map
const { mockGetSysConfigKeys } = vi.hoisted(() => ({
  mockGetSysConfigKeys: vi.fn(),
}))

vi.mock('#server/utils/configStore', () => ({ getSysConfigKeys: mockGetSysConfigKeys }))

beforeEach(() => {
  vi.clearAllMocks()
})

describe('mapAdminModerationEnabled', () => {
  it('键缺失（空 Map）→ 返回 true（缺省按开启，fail-closed）', () => {
    expect(mapAdminModerationEnabled(new Map())).toBe(true)
  })

  it('值为 1 → true', () => {
    expect(mapAdminModerationEnabled(new Map([['admin_moderation_enabled', '1']]))).toBe(true)
  })

  it('值为 0 → false', () => {
    expect(mapAdminModerationEnabled(new Map([['admin_moderation_enabled', '0']]))).toBe(false)
  })

  it('非法值（非 1）→ false', () => {
    expect(mapAdminModerationEnabled(new Map([['admin_moderation_enabled', 'abc']]))).toBe(false)
  })
})

describe('getAdminModerationEnabled', () => {
  it('configStore 缺键（Map 为空）→ true（开启，fail-closed）', async () => {
    mockGetSysConfigKeys.mockResolvedValueOnce(new Map())
    await expect(getAdminModerationEnabled()).resolves.toBe(true)
  })

  it('configStore 命中 0 → false', async () => {
    mockGetSysConfigKeys.mockResolvedValueOnce(new Map([['admin_moderation_enabled', '0']]))
    await expect(getAdminModerationEnabled()).resolves.toBe(false)
  })

  it('configStore 异常 → true（开启兜底，fail-closed）', async () => {
    mockGetSysConfigKeys.mockRejectedValueOnce(new Error('configStore down'))
    await expect(getAdminModerationEnabled()).resolves.toBe(true)
  })
})
