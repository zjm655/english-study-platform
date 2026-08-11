import { describe, it, expect, vi, beforeEach } from 'vitest'

import {
  mapRowsToDeepseekTimeouts,
  getDeepseekTimeouts,
  invalidateDeepseekConfigCache,
  DEFAULT_DEEPSEEK_TIMEOUT_MS,
  DEFAULT_DEEPSEEK_TITLE_TIMEOUT_MS,
} from '../deepseekConfig'

// 模块内部用 query 查 sys_config，mock 掉 db.query 即可隔离逻辑（不依赖真实 DB）
const { mockQuery } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
}))

vi.mock('#server/utils/db', () => ({ query: mockQuery }))

/** 完整合法的 sys_config 行（与 033 迁移 seed 同键，取非默认值验证真实解析） */
const FULL_ROWS = [
  { config_key: 'deepseek_timeout_ms', config_value: '90000' },
  { config_key: 'deepseek_title_timeout_ms', config_value: '45000' },
]

beforeEach(() => {
  vi.clearAllMocks()
  // 模块级缓存需在每条用例前清掉避免互相污染
  invalidateDeepseekConfigCache()
})

// ============ 纯映射函数 ============

describe('mapRowsToDeepseekTimeouts - 正常解析', () => {
  it('2 键齐全时逐键解析为 number', () => {
    expect(mapRowsToDeepseekTimeouts(FULL_ROWS)).toEqual({
      contentTimeoutMs: 90000,
      titleTimeoutMs: 45000,
    })
  })

  it('数值型字符串带尾随字符时 parseInt 取前缀数字（与 uploadLimitChecker 同口径）', () => {
    const rows = [{ config_key: 'deepseek_timeout_ms', config_value: '120000abc' }]
    expect(mapRowsToDeepseekTimeouts(rows).contentTimeoutMs).toBe(120000)
  })
})

describe('mapRowsToDeepseekTimeouts - 缺键兜底', () => {
  it('空行集：全部回退默认值', () => {
    expect(mapRowsToDeepseekTimeouts([])).toEqual({
      contentTimeoutMs: DEFAULT_DEEPSEEK_TIMEOUT_MS,
      titleTimeoutMs: DEFAULT_DEEPSEEK_TITLE_TIMEOUT_MS,
    })
  })

  it('部分缺键：仅缺失键回退默认值，已有键正常解析', () => {
    const rows = [{ config_key: 'deepseek_timeout_ms', config_value: '150000' }]
    const timeouts = mapRowsToDeepseekTimeouts(rows)
    expect(timeouts.contentTimeoutMs).toBe(150000)
    expect(timeouts.titleTimeoutMs).toBe(DEFAULT_DEEPSEEK_TITLE_TIMEOUT_MS)
  })
})

describe('mapRowsToDeepseekTimeouts - 非法值兜底', () => {
  it('0 值回退默认值（超时不允许为 0）', () => {
    const rows = [{ config_key: 'deepseek_timeout_ms', config_value: '0' }]
    expect(mapRowsToDeepseekTimeouts(rows).contentTimeoutMs).toBe(DEFAULT_DEEPSEEK_TIMEOUT_MS)
  })

  it('负数回退默认值', () => {
    const rows = [{ config_key: 'deepseek_title_timeout_ms', config_value: '-1000' }]
    expect(mapRowsToDeepseekTimeouts(rows).titleTimeoutMs).toBe(DEFAULT_DEEPSEEK_TITLE_TIMEOUT_MS)
  })

  it('非数值字符串（NaN）回退默认值', () => {
    const rows = [
      { config_key: 'deepseek_timeout_ms', config_value: 'abc' },
      { config_key: 'deepseek_title_timeout_ms', config_value: '' },
    ]
    const timeouts = mapRowsToDeepseekTimeouts(rows)
    expect(timeouts.contentTimeoutMs).toBe(DEFAULT_DEEPSEEK_TIMEOUT_MS)
    expect(timeouts.titleTimeoutMs).toBe(DEFAULT_DEEPSEEK_TITLE_TIMEOUT_MS)
  })
})

// ============ getDeepseekTimeouts（mock query，不依赖真实 DB） ============

describe('getDeepseekTimeouts - 缓存与旁路兜底', () => {
  it('首次查库解析，TTL 内二次调用不再查库', async () => {
    mockQuery.mockResolvedValue(FULL_ROWS)
    const first = await getDeepseekTimeouts()
    const second = await getDeepseekTimeouts()
    expect(first.contentTimeoutMs).toBe(90000)
    expect(first.titleTimeoutMs).toBe(45000)
    expect(second).toEqual(first)
    expect(mockQuery).toHaveBeenCalledTimes(1)
  })

  it('invalidateDeepseekConfigCache 后重新查库', async () => {
    mockQuery.mockResolvedValue(FULL_ROWS)
    await getDeepseekTimeouts()
    invalidateDeepseekConfigCache()
    mockQuery.mockResolvedValue([{ config_key: 'deepseek_timeout_ms', config_value: '200000' }])
    const timeouts = await getDeepseekTimeouts()
    expect(timeouts.contentTimeoutMs).toBe(200000)
    expect(mockQuery).toHaveBeenCalledTimes(2)
  })

  it('查库异常时返回全默认值（旁路不阻断业务）', async () => {
    mockQuery.mockRejectedValue(new Error('db down'))
    await expect(getDeepseekTimeouts()).resolves.toEqual({
      contentTimeoutMs: DEFAULT_DEEPSEEK_TIMEOUT_MS,
      titleTimeoutMs: DEFAULT_DEEPSEEK_TITLE_TIMEOUT_MS,
    })
  })

  it('查库异常不写缓存：恢复后下次调用读到真实配置', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'))
    await getDeepseekTimeouts()
    mockQuery.mockResolvedValue(FULL_ROWS)
    const timeouts = await getDeepseekTimeouts()
    expect(timeouts.contentTimeoutMs).toBe(90000)
  })
})
