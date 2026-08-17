import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  mapAdminModerationEnabled,
  getAdminModerationEnabled,
  invalidateAdminModerationCache,
} from '../moderationConfig'

// ===== admin_moderation_enabled 开关解析/缓存测试 =====
const mockQuery = vi.hoisted(() => vi.fn())
vi.mock('#server/utils/db', () => ({ query: mockQuery }))

beforeEach(() => {
  vi.clearAllMocks()
  invalidateAdminModerationCache()
})

describe('mapAdminModerationEnabled', () => {
  it('键缺失 → 返回 true（缺省按开启，fail-closed）', () => {
    expect(mapAdminModerationEnabled([])).toBe(true)
  })

  it('值为 1 → true', () => {
    expect(mapAdminModerationEnabled([{ config_key: 'admin_moderation_enabled', config_value: '1' }])).toBe(true)
  })

  it('值为 0 → false', () => {
    expect(mapAdminModerationEnabled([{ config_key: 'admin_moderation_enabled', config_value: '0' }])).toBe(false)
  })

  it('非法值（非 1）→ false', () => {
    expect(mapAdminModerationEnabled([{ config_key: 'admin_moderation_enabled', config_value: 'abc' }])).toBe(false)
  })
})

describe('getAdminModerationEnabled', () => {
  it('查库成功：未命中键 → true（开启）', async () => {
    mockQuery.mockResolvedValue([])
    await expect(getAdminModerationEnabled()).resolves.toBe(true)
  })

  it('查库成功：命中 0 → false', async () => {
    mockQuery.mockResolvedValue([{ config_key: 'admin_moderation_enabled', config_value: '0' }])
    await expect(getAdminModerationEnabled()).resolves.toBe(false)
  })

  it('查库异常 → true（开启兜底）', async () => {
    mockQuery.mockRejectedValue(new Error('db down'))
    await expect(getAdminModerationEnabled()).resolves.toBe(true)
  })
})