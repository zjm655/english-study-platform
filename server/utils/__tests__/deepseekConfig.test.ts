import { describe, it, expect, vi, beforeEach } from 'vitest'

import {
  mapRowsToDeepseekParams,
  getDeepseekParams,
  invalidateDeepseekConfigCache,
  DEFAULT_DEEPSEEK_TIMEOUT_MS,
  DEFAULT_DEEPSEEK_TITLE_TIMEOUT_MS,
  DEFAULT_DEEPSEEK_CONTENT_MAX_TOKENS,
  DEFAULT_DEEPSEEK_TITLE_MAX_TOKENS,
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
  { config_key: 'deepseek_max_tokens', config_value: '6000' },
  { config_key: 'deepseek_title_max_tokens', config_value: '350' },
]

beforeEach(() => {
  vi.clearAllMocks()
  // 模块级缓存需在每条用例前清掉避免互相污染
  invalidateDeepseekConfigCache()
})

// ============ 纯映射函数 ============

describe('mapRowsToDeepseekParams - 正常解析', () => {
  it('4 键齐全（timeouts + max_tokens）时逐键解析为 number', () => {
    expect(mapRowsToDeepseekParams(FULL_ROWS)).toEqual({
      contentTimeoutMs: 90000,
      titleTimeoutMs: 45000,
      contentMaxTokens: 6000,
      titleMaxTokens: 350,
    })
  })

  it('数值型字符串带尾随字符时 parseInt 取前缀数字（与 uploadLimitChecker 同口径）', () => {
    const rows = [{ config_key: 'deepseek_timeout_ms', config_value: '120000abc' }]
    expect(mapRowsToDeepseekParams(rows).contentTimeoutMs).toBe(120000)
  })
})

describe('mapRowsToDeepseekParams - 缺键兜底', () => {
  it('空行集：全部回退默认值', () => {
    expect(mapRowsToDeepseekParams([])).toEqual({
      contentTimeoutMs: DEFAULT_DEEPSEEK_TIMEOUT_MS,
      titleTimeoutMs: DEFAULT_DEEPSEEK_TITLE_TIMEOUT_MS,
      contentMaxTokens: DEFAULT_DEEPSEEK_CONTENT_MAX_TOKENS,
      titleMaxTokens: DEFAULT_DEEPSEEK_TITLE_MAX_TOKENS,
    })
  })

  it('部分缺键：仅缺失键回退默认值，已有键正常解析', () => {
    const rows = [{ config_key: 'deepseek_timeout_ms', config_value: '150000' }]
    const params = mapRowsToDeepseekParams(rows)
    expect(params.contentTimeoutMs).toBe(150000)
    expect(params.titleTimeoutMs).toBe(DEFAULT_DEEPSEEK_TITLE_TIMEOUT_MS)
    expect(params.contentMaxTokens).toBe(DEFAULT_DEEPSEEK_CONTENT_MAX_TOKENS)
    expect(params.titleMaxTokens).toBe(DEFAULT_DEEPSEEK_TITLE_MAX_TOKENS)
  })

  it('max_tokens 缺键：回退默认 4000/200', () => {
    const rows = [
      { config_key: 'deepseek_timeout_ms', config_value: '120000' },
      { config_key: 'deepseek_title_timeout_ms', config_value: '60000' },
    ]
    const params = mapRowsToDeepseekParams(rows)
    expect(params.contentMaxTokens).toBe(DEFAULT_DEEPSEEK_CONTENT_MAX_TOKENS)
    expect(params.titleMaxTokens).toBe(DEFAULT_DEEPSEEK_TITLE_MAX_TOKENS)
  })
})

describe('mapRowsToDeepseekParams - 非法值兜底', () => {
  it('0 值回退默认值（超时不允许为 0）', () => {
    const rows = [{ config_key: 'deepseek_timeout_ms', config_value: '0' }]
    expect(mapRowsToDeepseekParams(rows).contentTimeoutMs).toBe(DEFAULT_DEEPSEEK_TIMEOUT_MS)
  })

  it('负数回退默认值', () => {
    const rows = [{ config_key: 'deepseek_title_timeout_ms', config_value: '-1000' }]
    expect(mapRowsToDeepseekParams(rows).titleTimeoutMs).toBe(DEFAULT_DEEPSEEK_TITLE_TIMEOUT_MS)
  })

  it('非数值字符串（NaN）回退默认值', () => {
    const rows = [
      { config_key: 'deepseek_timeout_ms', config_value: 'abc' },
      { config_key: 'deepseek_title_timeout_ms', config_value: '' },
    ]
    const params = mapRowsToDeepseekParams(rows)
    expect(params.contentTimeoutMs).toBe(DEFAULT_DEEPSEEK_TIMEOUT_MS)
    expect(params.titleTimeoutMs).toBe(DEFAULT_DEEPSEEK_TITLE_TIMEOUT_MS)
  })
})

describe('mapRowsToDeepseekParams - max_tokens 非法值兜底', () => {
  it('0/负数/NaN 回退默认值', () => {
    const rows = [
      { config_key: 'deepseek_max_tokens', config_value: '0' },
      { config_key: 'deepseek_title_max_tokens', config_value: '-50' },
    ]
    const params = mapRowsToDeepseekParams(rows)
    expect(params.contentMaxTokens).toBe(DEFAULT_DEEPSEEK_CONTENT_MAX_TOKENS)
    expect(params.titleMaxTokens).toBe(DEFAULT_DEEPSEEK_TITLE_MAX_TOKENS)

    const nanRows = [
      { config_key: 'deepseek_max_tokens', config_value: 'abc' },
      { config_key: 'deepseek_title_max_tokens', config_value: '' },
    ]
    const nanParams = mapRowsToDeepseekParams(nanRows)
    expect(nanParams.contentMaxTokens).toBe(DEFAULT_DEEPSEEK_CONTENT_MAX_TOKENS)
    expect(nanParams.titleMaxTokens).toBe(DEFAULT_DEEPSEEK_TITLE_MAX_TOKENS)
  })

  it('小于 100 回退默认值（边界：max_tokens 合法值下限 100）', () => {
    const rows = [{ config_key: 'deepseek_max_tokens', config_value: '99' }]
    expect(mapRowsToDeepseekParams(rows).contentMaxTokens).toBe(DEFAULT_DEEPSEEK_CONTENT_MAX_TOKENS)
  })

  it('恰好 100 视为合法（边界含端点）', () => {
    const rows = [{ config_key: 'deepseek_title_max_tokens', config_value: '100' }]
    expect(mapRowsToDeepseekParams(rows).titleMaxTokens).toBe(100)
  })
})

// ============ getDeepseekParams（mock query，不依赖真实 DB） ============

describe('getDeepseekParams - 缓存与旁路兜底', () => {
  it('首次查库解析，TTL 内二次调用不再查库', async () => {
    mockQuery.mockResolvedValue(FULL_ROWS)
    const first = await getDeepseekParams()
    const second = await getDeepseekParams()
    expect(first.contentTimeoutMs).toBe(90000)
    expect(first.titleTimeoutMs).toBe(45000)
    expect(first.contentMaxTokens).toBe(6000)
    expect(first.titleMaxTokens).toBe(350)
    expect(second).toEqual(first)
    expect(mockQuery).toHaveBeenCalledTimes(1)
  })

  it('invalidateDeepseekConfigCache 后重新查库', async () => {
    mockQuery.mockResolvedValue(FULL_ROWS)
    await getDeepseekParams()
    invalidateDeepseekConfigCache()
    mockQuery.mockResolvedValue([{ config_key: 'deepseek_timeout_ms', config_value: '200000' }])
    const params = await getDeepseekParams()
    expect(params.contentTimeoutMs).toBe(200000)
    expect(mockQuery).toHaveBeenCalledTimes(2)
  })

  it('查库异常时返回全默认值（旁路不阻断业务）', async () => {
    mockQuery.mockRejectedValue(new Error('db down'))
    await expect(getDeepseekParams()).resolves.toEqual({
      contentTimeoutMs: DEFAULT_DEEPSEEK_TIMEOUT_MS,
      titleTimeoutMs: DEFAULT_DEEPSEEK_TITLE_TIMEOUT_MS,
      contentMaxTokens: DEFAULT_DEEPSEEK_CONTENT_MAX_TOKENS,
      titleMaxTokens: DEFAULT_DEEPSEEK_TITLE_MAX_TOKENS,
    })
  })

  it('查库异常不写缓存：恢复后下次调用读到真实配置', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'))
    await getDeepseekParams()
    mockQuery.mockResolvedValue(FULL_ROWS)
    const params = await getDeepseekParams()
    expect(params.contentTimeoutMs).toBe(90000)
  })
})
