import { describe, it, expect, vi, beforeEach } from 'vitest'

// ===== signAvatarUrl / uploadImagePublic 测试 =====
// 背景：bucket 开启「阻止公共访问」，对象级 ACL 被服务端拒绝，
// 头像统一走 signUrl V4 临时签名（AVATAR_EXPIRE=2100 与材料音频同口径）。
// 覆盖：null 安全 / 完整公网 URL 提取 key 签名 / 裸 key 直签 / 签名失败降级 /
// uploadImagePublic 恢复三参、put 不携带 ACL 头。

// ===== mock 全局自动导入（oss.ts 模块顶层读 useRuntimeConfig，方法内用 logger） =====
;(globalThis as Record<string, unknown>).logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  log: vi.fn(),
}
;(globalThis as Record<string, unknown>).useRuntimeConfig = () => ({
  oss: {
    region: 'oss-cn-test',
    bucket: 'test-bucket',
    accessKeyId: 'ak',
    accessKeySecret: 'sk',
    useInternal: false,
  },
})

// ===== mock ali-oss SDK =====
const { mockSignatureUrlV4, mockPut } = vi.hoisted(() => ({
  mockSignatureUrlV4: vi.fn(),
  mockPut: vi.fn(),
}))
vi.mock('ali-oss', () => ({
  default: class OSS {
    constructor(public opts: unknown) {}
    signatureUrlV4 = mockSignatureUrlV4
    put = mockPut
  },
}))

// ===== mock 日志类依赖，避免落盘 =====
vi.mock('../fileLogger', () => ({ fileLog: vi.fn(), fileLogError: vi.fn() }))
vi.mock('../cloudServiceLog', () => ({ logCloudServiceCall: vi.fn() }))

// 动态 import：破除模块级 client 单例状态
async function loadModule() {
  vi.resetModules()
  return import('../oss')
}

beforeEach(() => {
  vi.clearAllMocks()
  mockSignatureUrlV4.mockResolvedValue('https://signed.example.com/avatars/1.png?sig=xxx')
})

describe('signAvatarUrl', () => {
  it('AVATAR_EXPIRE 为 2100 秒（35 分钟，与材料音频一致）', async () => {
    const { AVATAR_EXPIRE, MATERIAL_EXPIRE } = await loadModule()
    expect(AVATAR_EXPIRE).toBe(2100)
    expect(AVATAR_EXPIRE).toBe(MATERIAL_EXPIRE)
  })

  it('null 入参直接返回 null，不触发签名', async () => {
    const { signAvatarUrl } = await loadModule()
    expect(await signAvatarUrl(null)).toBeNull()
    expect(mockSignatureUrlV4).not.toHaveBeenCalled()
  })

  it('完整公网 URL（存量落库格式）→ 提取 key 并以 AVATAR_EXPIRE 签名', async () => {
    const { signAvatarUrl } = await loadModule()
    const raw = 'https://test-bucket.oss-cn-test.aliyuncs.com/avatars/1690000000_1.png'
    const signed = await signAvatarUrl(raw)
    expect(signed).toBe('https://signed.example.com/avatars/1.png?sig=xxx')
    expect(mockSignatureUrlV4).toHaveBeenCalledTimes(1)
    expect(mockSignatureUrlV4).toHaveBeenCalledWith(
      'GET',
      2100,
      { headers: {}, queries: {} },
      'avatars/1690000000_1.png',
    )
  })

  it('裸 key（未来落库格式）→ 直接以该 key 签名', async () => {
    const { signAvatarUrl } = await loadModule()
    const signed = await signAvatarUrl('avatars/1690000000_2.webp')
    expect(signed).toBe('https://signed.example.com/avatars/1.png?sig=xxx')
    expect(mockSignatureUrlV4).toHaveBeenCalledWith(
      'GET',
      2100,
      { headers: {}, queries: {} },
      'avatars/1690000000_2.webp',
    )
  })

  it('签名失败时降级返回原串（不抛错）', async () => {
    mockSignatureUrlV4.mockRejectedValue(new Error('network down'))
    const { signAvatarUrl } = await loadModule()
    const raw = 'https://test-bucket.oss-cn-test.aliyuncs.com/avatars/3.png'
    expect(await signAvatarUrl(raw)).toBe(raw)
  })
})

describe('uploadImagePublic（三参，无 ACL）', () => {
  it('put 仅带 key 与 buffer，不携带 x-oss-object-acl 头', async () => {
    mockPut.mockResolvedValue({
      url: 'https://test-bucket.oss-cn-test.aliyuncs.com/avatars/1.png',
      name: 'avatars/1.png',
    })
    const { uploadImagePublic } = await loadModule()
    const buf = Buffer.from('img')
    const result = await uploadImagePublic(buf, '1.png', 'avatars/')

    expect(mockPut).toHaveBeenCalledTimes(1)
    // 恒定两参调用：无第三个 options 参数，自然不含 ACL 头
    expect(mockPut.mock.calls[0]).toHaveLength(2)
    expect(String(mockPut.mock.calls[0]![0])).toMatch(/^avatars\/\d+_1\.png$/)
    expect(result.url).toBe('https://test-bucket.oss-cn-test.aliyuncs.com/avatars/1.png')
    expect(result.size).toBe(buf.length)
  })

  it('内网域名归一化：-internal 后缀被替换为公网域名', async () => {
    mockPut.mockResolvedValue({
      url: 'https://test-bucket.oss-cn-test-internal.aliyuncs.com/avatars/2.png',
      name: 'avatars/2.png',
    })
    const { uploadImagePublic } = await loadModule()
    const result = await uploadImagePublic(Buffer.from('img'), '2.png', 'avatars/')
    expect(result.url).toBe('https://test-bucket.oss-cn-test.aliyuncs.com/avatars/2.png')
  })
})
