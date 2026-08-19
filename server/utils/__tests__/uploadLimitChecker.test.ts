import { describe, it, expect, vi, beforeEach } from 'vitest'

import { mapRowsToUploadLimits, getUploadLimits, validateUploadText } from '../uploadLimitChecker'
import { DEFAULT_UPLOAD_LIMITS } from '#shared/utils/uploadLimits'

// 配置读取已接入 configStore（模块内不再自建缓存），mock getSysConfigKeys 返回固定 Map
const { mockGetSysConfigKeys } = vi.hoisted(() => ({
  mockGetSysConfigKeys: vi.fn(),
}))

vi.mock('#server/utils/configStore', () => ({ getSysConfigKeys: mockGetSysConfigKeys }))

/** 完整合法的 sys_config 行（与 024/040 迁移 seed 同键，取非默认值验证真实解析） */
const FULL_ROWS = [
  { config_key: 'upload_max_duration_user', config_value: '120' },
  { config_key: 'upload_max_duration_admin', config_value: '900' },
  { config_key: 'upload_max_size_user', config_value: '1048576' },
  { config_key: 'upload_max_size_admin', config_value: '10485760' },
  { config_key: 'upload_recording_max_size', config_value: '20971520' },
  { config_key: 'upload_queue_max', config_value: '30' },
  { config_key: 'upload_min_text_user', config_value: '20' },
  { config_key: 'upload_max_text_user', config_value: '4000' },
  { config_key: 'upload_min_text_admin', config_value: '5' },
  { config_key: 'upload_max_text_admin', config_value: '8000' },
]

/** configStore 返回形态：原始字符串 Map（缺键不在其中，调用方走默认值） */
const fullMap = () => new Map(FULL_ROWS.map((r) => [r.config_key, r.config_value]))

beforeEach(() => {
  vi.clearAllMocks()
})

// ============ 纯映射函数 ============

describe('mapRowsToUploadLimits - 正常解析', () => {
  it('10 键齐全时逐键解析为 number', () => {
    expect(mapRowsToUploadLimits(FULL_ROWS)).toEqual({
      maxAudioDurationUser: 120,
      maxAudioDurationAdmin: 900,
      maxAudioSizeUser: 1048576,
      maxAudioSizeAdmin: 10485760,
      recordingMaxSize: 20971520,
      uploadQueueMax: 30,
      minTextUser: 20,
      maxTextUser: 4000,
      minTextAdmin: 5,
      maxTextAdmin: 8000,
    })
  })

  it('数值型字符串带尾随字符时 parseInt 取前缀数字（与 quotaChecker 同口径）', () => {
    const rows = [{ config_key: 'upload_queue_max', config_value: '30abc' }]
    expect(mapRowsToUploadLimits(rows).uploadQueueMax).toBe(30)
  })
})

describe('mapRowsToUploadLimits - 缺键兜底', () => {
  it('空行集：全部回退默认值', () => {
    expect(mapRowsToUploadLimits([])).toEqual(DEFAULT_UPLOAD_LIMITS)
  })

  it('部分缺键：仅缺失键回退默认值，已有键正常解析', () => {
    const rows = [
      { config_key: 'upload_max_duration_user', config_value: '240' },
      { config_key: 'upload_queue_max', config_value: '10' },
      { config_key: 'upload_max_text_admin', config_value: '6000' },
    ]
    const limits = mapRowsToUploadLimits(rows)
    expect(limits.maxAudioDurationUser).toBe(240)
    expect(limits.uploadQueueMax).toBe(10)
    expect(limits.maxTextAdmin).toBe(6000)
    expect(limits.maxAudioDurationAdmin).toBe(DEFAULT_UPLOAD_LIMITS.maxAudioDurationAdmin)
    expect(limits.maxAudioSizeUser).toBe(DEFAULT_UPLOAD_LIMITS.maxAudioSizeUser)
    expect(limits.maxAudioSizeAdmin).toBe(DEFAULT_UPLOAD_LIMITS.maxAudioSizeAdmin)
    expect(limits.recordingMaxSize).toBe(DEFAULT_UPLOAD_LIMITS.recordingMaxSize)
    expect(limits.minTextUser).toBe(DEFAULT_UPLOAD_LIMITS.minTextUser)
    expect(limits.maxTextUser).toBe(DEFAULT_UPLOAD_LIMITS.maxTextUser)
    expect(limits.minTextAdmin).toBe(DEFAULT_UPLOAD_LIMITS.minTextAdmin)
  })
})

describe('mapRowsToUploadLimits - 非法值兜底', () => {
  it('0 值回退默认值（限制值不允许为 0）', () => {
    const rows = [{ config_key: 'upload_max_size_user', config_value: '0' }]
    expect(mapRowsToUploadLimits(rows).maxAudioSizeUser).toBe(
      DEFAULT_UPLOAD_LIMITS.maxAudioSizeUser,
    )
  })

  it('负数回退默认值', () => {
    const rows = [{ config_key: 'upload_max_duration_admin', config_value: '-600' }]
    expect(mapRowsToUploadLimits(rows).maxAudioDurationAdmin).toBe(
      DEFAULT_UPLOAD_LIMITS.maxAudioDurationAdmin,
    )
  })

  it('非数值字符串（NaN）回退默认值', () => {
    const rows = [
      { config_key: 'upload_recording_max_size', config_value: 'abc' },
      { config_key: 'upload_queue_max', config_value: '' },
    ]
    const limits = mapRowsToUploadLimits(rows)
    expect(limits.recordingMaxSize).toBe(DEFAULT_UPLOAD_LIMITS.recordingMaxSize)
    expect(limits.uploadQueueMax).toBe(DEFAULT_UPLOAD_LIMITS.uploadQueueMax)
  })

  it('文本键 0 / 负数 / NaN 均回退默认值', () => {
    const rows = [
      { config_key: 'upload_min_text_user', config_value: '0' },
      { config_key: 'upload_max_text_user', config_value: '-1' },
      { config_key: 'upload_min_text_admin', config_value: 'abc' },
      { config_key: 'upload_max_text_admin', config_value: '' },
    ]
    const limits = mapRowsToUploadLimits(rows)
    expect(limits.minTextUser).toBe(DEFAULT_UPLOAD_LIMITS.minTextUser)
    expect(limits.maxTextUser).toBe(DEFAULT_UPLOAD_LIMITS.maxTextUser)
    expect(limits.minTextAdmin).toBe(DEFAULT_UPLOAD_LIMITS.minTextAdmin)
    expect(limits.maxTextAdmin).toBe(DEFAULT_UPLOAD_LIMITS.maxTextAdmin)
  })
})

// ============ validateUploadText（文本长度校验纯函数） ============

/** 独立于 DEFAULT 的已知字面量（user 与 admin 档位刻意不同，验证角色分档） */
const TEST_LIMITS = {
  maxAudioDurationUser: 180,
  maxAudioDurationAdmin: 600,
  maxAudioSizeUser: 2097152,
  maxAudioSizeAdmin: 5242880,
  recordingMaxSize: 52428800,
  uploadQueueMax: 50,
  minTextUser: 10,
  maxTextUser: 5000,
  minTextAdmin: 5,
  maxTextAdmin: 8000,
}

describe('validateUploadText', () => {
  it('合法文本：trim 后返回，上下限内放行', () => {
    const res = validateUploadText('  Hello world  ', TEST_LIMITS, 'user')
    expect(res).toEqual({ ok: true, text: 'Hello world' })
  })

  it('空串 / 纯空白：拒绝「材料文本不能为空」', () => {
    expect(validateUploadText('', TEST_LIMITS, 'user')).toEqual({
      ok: false,
      message: '材料文本不能为空',
    })
    expect(validateUploadText('   ', TEST_LIMITS, 'admin')).toEqual({
      ok: false,
      message: '材料文本不能为空',
    })
  })

  it('低于下限：拒绝并提示动态下限值', () => {
    expect(validateUploadText('hi', TEST_LIMITS, 'user')).toEqual({
      ok: false,
      message: '材料文本不能少于10个字符',
    })
  })

  it('超过上限：拒绝并提示动态上限值', () => {
    expect(validateUploadText('a'.repeat(5001), TEST_LIMITS, 'user')).toEqual({
      ok: false,
      message: '材料文本不能超过5000个字符',
    })
  })

  it('角色分档：admin 用 admin 档位（下限 5 / 上限 8000）', () => {
    // 5 字符：admin 档放行（下限 5），user 档拒绝（下限 10）——证明按角色取档
    expect(validateUploadText('hello', TEST_LIMITS, 'admin')).toEqual({
      ok: true,
      text: 'hello',
    })
    expect(validateUploadText('hello', TEST_LIMITS, 'user')).toEqual({
      ok: false,
      message: '材料文本不能少于10个字符',
    })
    expect(validateUploadText('a'.repeat(8001), TEST_LIMITS, 'admin')).toEqual({
      ok: false,
      message: '材料文本不能超过8000个字符',
    })
  })

  it('边界值恰好等于下限/上限：放行（含等号）', () => {
    expect(validateUploadText('a'.repeat(10), TEST_LIMITS, 'user').ok).toBe(true)
    expect(validateUploadText('a'.repeat(5000), TEST_LIMITS, 'user').ok).toBe(true)
  })
})

// ============ getUploadLimits（mock configStore，不依赖真实 DB/Redis） ============

describe('getUploadLimits - configStore 读取与旁路兜底', () => {
  it('一次批量传入全部 10 键并正确解析', async () => {
    mockGetSysConfigKeys.mockResolvedValueOnce(fullMap())
    const limits = await getUploadLimits()
    expect(limits.maxAudioDurationUser).toBe(120)
    expect(limits.uploadQueueMax).toBe(30)
    expect(mockGetSysConfigKeys).toHaveBeenCalledTimes(1)
    expect(mockGetSysConfigKeys.mock.calls[0]![0]).toEqual([
      'upload_max_duration_user',
      'upload_max_duration_admin',
      'upload_max_size_user',
      'upload_max_size_admin',
      'upload_recording_max_size',
      'upload_queue_max',
      'upload_min_text_user',
      'upload_max_text_user',
      'upload_min_text_admin',
      'upload_max_text_admin',
    ])
  })

  it('模块内无缓存：每次调用都委托 configStore（缓存语义由 configStore 承载）', async () => {
    mockGetSysConfigKeys.mockResolvedValue(fullMap())
    const first = await getUploadLimits()
    const second = await getUploadLimits()
    expect(second).toEqual(first)
    expect(mockGetSysConfigKeys).toHaveBeenCalledTimes(2)
  })

  it('配置变更即时生效：configStore 返回新值后下次调用立即采用（无需 invalidate）', async () => {
    mockGetSysConfigKeys
      .mockResolvedValueOnce(fullMap())
      .mockResolvedValueOnce(new Map([['upload_queue_max', '5']]))
    await getUploadLimits()
    const limits = await getUploadLimits()
    expect(limits.uploadQueueMax).toBe(5)
  })

  it('configStore 异常时返回全默认值（旁路不阻断业务）', async () => {
    mockGetSysConfigKeys.mockRejectedValue(new Error('configStore down'))
    await expect(getUploadLimits()).resolves.toEqual(DEFAULT_UPLOAD_LIMITS)
  })

  it('configStore 异常恢复后下次调用读到真实配置', async () => {
    mockGetSysConfigKeys.mockRejectedValueOnce(new Error('configStore down'))
    await getUploadLimits()
    mockGetSysConfigKeys.mockResolvedValueOnce(fullMap())
    const limits = await getUploadLimits()
    expect(limits.uploadQueueMax).toBe(30)
  })
})
