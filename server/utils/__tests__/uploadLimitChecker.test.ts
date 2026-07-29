import { describe, it, expect, vi, beforeEach } from 'vitest'

import {
  mapRowsToUploadLimits,
  getUploadLimits,
  invalidateUploadLimitCache,
  DEFAULT_UPLOAD_LIMITS,
} from '../uploadLimitChecker'

// 模块内部用 query 查 sys_config，mock 掉 db.query 即可隔离逻辑（不依赖真实 DB）
const { mockQuery } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
}))

vi.mock('#server/utils/db', () => ({ query: mockQuery }))

/** 完整合法的 sys_config 行（与 024 迁移 seed 同键，取非默认值验证真实解析） */
const FULL_ROWS = [
  { config_key: 'upload_max_duration_user', config_value: '120' },
  { config_key: 'upload_max_duration_admin', config_value: '900' },
  { config_key: 'upload_max_size_user', config_value: '1048576' },
  { config_key: 'upload_max_size_admin', config_value: '10485760' },
  { config_key: 'upload_recording_max_size', config_value: '20971520' },
  { config_key: 'upload_queue_max', config_value: '30' },
]

beforeEach(() => {
  vi.clearAllMocks()
  // 模块级缓存需在每条用例前清掉避免互相污染
  invalidateUploadLimitCache()
})

// ============ 纯映射函数 ============

describe('mapRowsToUploadLimits - 正常解析', () => {
  it('6 键齐全时逐键解析为 number', () => {
    expect(mapRowsToUploadLimits(FULL_ROWS)).toEqual({
      maxAudioDurationUser: 120,
      maxAudioDurationAdmin: 900,
      maxAudioSizeUser: 1048576,
      maxAudioSizeAdmin: 10485760,
      recordingMaxSize: 20971520,
      uploadQueueMax: 30,
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
    ]
    const limits = mapRowsToUploadLimits(rows)
    expect(limits.maxAudioDurationUser).toBe(240)
    expect(limits.uploadQueueMax).toBe(10)
    expect(limits.maxAudioDurationAdmin).toBe(DEFAULT_UPLOAD_LIMITS.maxAudioDurationAdmin)
    expect(limits.maxAudioSizeUser).toBe(DEFAULT_UPLOAD_LIMITS.maxAudioSizeUser)
    expect(limits.maxAudioSizeAdmin).toBe(DEFAULT_UPLOAD_LIMITS.maxAudioSizeAdmin)
    expect(limits.recordingMaxSize).toBe(DEFAULT_UPLOAD_LIMITS.recordingMaxSize)
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
})

// ============ getUploadLimits（mock query，不依赖真实 DB） ============

describe('getUploadLimits - 缓存与旁路兜底', () => {
  it('首次查库解析，TTL 内二次调用不再查库', async () => {
    mockQuery.mockResolvedValue(FULL_ROWS)
    const first = await getUploadLimits()
    const second = await getUploadLimits()
    expect(first.maxAudioDurationUser).toBe(120)
    expect(second).toEqual(first)
    expect(mockQuery).toHaveBeenCalledTimes(1)
  })

  it('invalidateUploadLimitCache 后重新查库', async () => {
    mockQuery.mockResolvedValue(FULL_ROWS)
    await getUploadLimits()
    invalidateUploadLimitCache()
    mockQuery.mockResolvedValue([{ config_key: 'upload_queue_max', config_value: '5' }])
    const limits = await getUploadLimits()
    expect(limits.uploadQueueMax).toBe(5)
    expect(mockQuery).toHaveBeenCalledTimes(2)
  })

  it('查库异常时返回全默认值（旁路不阻断业务）', async () => {
    mockQuery.mockRejectedValue(new Error('db down'))
    await expect(getUploadLimits()).resolves.toEqual(DEFAULT_UPLOAD_LIMITS)
  })

  it('查库异常不写缓存：恢复后下次调用读到真实配置', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'))
    await getUploadLimits()
    mockQuery.mockResolvedValue(FULL_ROWS)
    const limits = await getUploadLimits()
    expect(limits.uploadQueueMax).toBe(30)
  })
})
