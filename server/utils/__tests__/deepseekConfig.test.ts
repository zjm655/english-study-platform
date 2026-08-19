import { describe, it, expect, vi, beforeEach } from 'vitest'

import {
  mapRowsToDeepseekParams,
  getDeepseekParams,
  DEFAULT_DEEPSEEK_TIMEOUT_MS,
  DEFAULT_DEEPSEEK_TITLE_TIMEOUT_MS,
  DEFAULT_DEEPSEEK_CONTENT_MAX_TOKENS,
  DEFAULT_DEEPSEEK_TITLE_MAX_TOKENS,
} from '../deepseekConfig'

// 配置读取已接入 configStore（模块内不再自建缓存），mock getSysConfigKeys 返回固定 Map
const { mockGetSysConfigKeys } = vi.hoisted(() => ({
  mockGetSysConfigKeys: vi.fn(),
}))

vi.mock('#server/utils/configStore', () => ({ getSysConfigKeys: mockGetSysConfigKeys }))

/** 完整合法的 sys_config 行（与 033 迁移 seed 同键，取非默认值验证真实解析） */
const FULL_ROWS = [
  { config_key: 'deepseek_timeout_ms', config_value: '90000' },
  { config_key: 'deepseek_title_timeout_ms', config_value: '45000' },
  { config_key: 'deepseek_max_tokens', config_value: '6000' },
  { config_key: 'deepseek_title_max_tokens', config_value: '350' },
]

/** configStore 返回形态：原始字符串 Map（缺键不在其中，调用方走默认值） */
const fullMap = () => new Map(FULL_ROWS.map((r) => [r.config_key, r.config_value]))

beforeEach(() => {
  vi.clearAllMocks()
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

// ============ getDeepseekParams（mock configStore，不依赖真实 DB/Redis） ============

describe('getDeepseekParams - configStore 读取与旁路兜底', () => {
  it('一次批量传入全部 4 键并正确解析', async () => {
    mockGetSysConfigKeys.mockResolvedValueOnce(fullMap())
    const params = await getDeepseekParams()
    expect(params.contentTimeoutMs).toBe(90000)
    expect(params.titleTimeoutMs).toBe(45000)
    expect(params.contentMaxTokens).toBe(6000)
    expect(params.titleMaxTokens).toBe(350)
    expect(mockGetSysConfigKeys).toHaveBeenCalledTimes(1)
    expect(mockGetSysConfigKeys.mock.calls[0]![0]).toEqual([
      'deepseek_timeout_ms',
      'deepseek_title_timeout_ms',
      'deepseek_max_tokens',
      'deepseek_title_max_tokens',
    ])
  })

  it('模块内无缓存：每次调用都委托 configStore（缓存语义由 configStore 承载）', async () => {
    mockGetSysConfigKeys.mockResolvedValue(fullMap())
    const first = await getDeepseekParams()
    const second = await getDeepseekParams()
    expect(second).toEqual(first)
    expect(mockGetSysConfigKeys).toHaveBeenCalledTimes(2)
  })

  it('配置变更即时生效：configStore 返回新值后下次调用立即采用（无需 invalidate）', async () => {
    mockGetSysConfigKeys
      .mockResolvedValueOnce(fullMap())
      .mockResolvedValueOnce(new Map([['deepseek_timeout_ms', '200000']]))
    await getDeepseekParams()
    const params = await getDeepseekParams()
    expect(params.contentTimeoutMs).toBe(200000)
  })

  it('configStore 异常时返回全默认值（旁路不阻断业务）', async () => {
    mockGetSysConfigKeys.mockRejectedValue(new Error('configStore down'))
    await expect(getDeepseekParams()).resolves.toEqual({
      contentTimeoutMs: DEFAULT_DEEPSEEK_TIMEOUT_MS,
      titleTimeoutMs: DEFAULT_DEEPSEEK_TITLE_TIMEOUT_MS,
      contentMaxTokens: DEFAULT_DEEPSEEK_CONTENT_MAX_TOKENS,
      titleMaxTokens: DEFAULT_DEEPSEEK_TITLE_MAX_TOKENS,
    })
  })

  it('configStore 异常恢复后下次调用读到真实配置', async () => {
    mockGetSysConfigKeys.mockRejectedValueOnce(new Error('configStore down'))
    await getDeepseekParams()
    mockGetSysConfigKeys.mockResolvedValueOnce(fullMap())
    const params = await getDeepseekParams()
    expect(params.contentTimeoutMs).toBe(90000)
  })
})
