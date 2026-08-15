import OSS from 'ali-oss'
import { fileLog, fileLogError } from './fileLogger'
import { logCloudServiceCall } from './cloudServiceLog'

// ==================== Bucket 统计（管理后台云服务模块） ====================

import type { OssBucketStat } from '#shared/types/adminCloud'
interface Options {
  /** access secret you create */
  accessKeyId: string
  /** access secret you create */
  accessKeySecret: string
  /** used by temporary authorization */
  stsToken?: string | undefined
  /** the default bucket you want to access If you don't have any bucket, please use putBucket() create one first. */
  bucket?: string | undefined
  /** oss region domain. It takes priority over region. */
  endpoint?: string | undefined
  /** the bucket data region location, please see Data Regions, default is oss-cn-hangzhou. */
  region?: string | undefined
  /** access OSS with aliyun internal network or not, default is false. If your servers are running on aliyun too, you can set true to save lot of money. */
  internal?: boolean | undefined
  /** instruct OSS client to use HTTPS (secure: true) or HTTP (secure: false) protocol. */
  secure?: boolean | undefined
  /** instance level timeout for all operations, default is 60s */
  timeout?: string | number | undefined
  /** use custom domain name */
  cname?: boolean | undefined
  /** use time (ms) of refresh STSToken interval it should be less than sts info expire interval, default is 300000ms(5min) when sts info expires. */
  refreshSTSTokenInterval?: number
  /** used by auto set stsToken、accessKeyId、accessKeySecret when sts info expires. return value must be object contains stsToken、accessKeyId、accessKeySecret */
  refreshSTSToken?: () => Promise<{
    accessKeyId: string
    accessKeySecret: string
    stsToken: string
  }>
  /** Use V4 signature. Default is false. */
  authorizationV4?: boolean | undefined
}

/** 上传成功后的返回结构 */
export interface UploadResult {
  /** 公网可访问的 URL（已自动将内网域名替换为公网） */
  url: string
  /** OSS 对象名（即 key） */
  name: string
  /** 文件大小（字节） */
  size: number
}

/** 配置对象结构（用于强约束 config.oss） */
interface OssConfig {
  region: string
  bucket: string
  accessKeyId: string
  accessKeySecret: string
  useInternal: boolean
}

let client: OSS | null = null
let internalClient: OSS | null = null
const config: OssConfig = useRuntimeConfig().oss

function buildOssOptions(options: Partial<Options> = {}): Options {
  const baseOptions: Options = {
    ...config,
    secure: true, // 使用 HTTPS
    authorizationV4: true,
  }
  const finalOptions = { ...baseOptions, ...options }
  if (!finalOptions.endpoint) {
    // 自动构造标准 Endpoint
    const internalSuffix = finalOptions.internal ? '-internal' : ''
    finalOptions.endpoint = `https://${config.region}${internalSuffix}.aliyuncs.com`
  }
  return finalOptions
}

/**
 * 获取公网客户端（单例模式）
 * 用于生成公网签名链接、外部访问等
 */
function getClient(): OSS {
  if (!client) {
    client = new OSS(buildOssOptions())
  }
  return client
}

/**
 * 获取内网客户端（单例模式）
 * 适用于部署在阿里云 ECS 等内网环境的服务，上传速度快且免流量费
 */
function getInternalClient(): OSS {
  if (!internalClient) {
    internalClient = new OSS(
      buildOssOptions({
        internal: true,
        // endpoint 会在 buildOssOptions 中自动添加 '-internal'
      }),
    )
  }
  return internalClient
}

/**
 * 获取上传用客户端（按 config.useInternal 开关选择公网/内网）
 * 公网部署到阿里云 ECS 同 region 时，置 useInternal=true 走内网免流量费且更稳定
 */
function getUploadClient(): OSS {
  return config.useInternal ? getInternalClient() : getClient()
}

// ---------- 工具函数 ----------

/**
 * 清理文件名：移除中文字符、空格、特殊符号，仅保留安全字符
 * @param fileName 原始文件名
 * @returns 清理后的文件名，若结果为空则返回 'image'
 */
function sanitizeFileName(fileName: string): string {
  return (
    fileName
      .replace(/\P{ASCII}/gu, '') // 移除非 ASCII 字符（中文、emoji 等）
      .trim()
      .replace(/\s+/g, '_') // 连续空格转单下划线
      .replace(/[^a-zA-Z0-9._-]/g, '') || // 只保留字母数字 . _ -
    'image'
  )
}

// ---------- 核心功能：上传 ----------
/**
 * 上传文件到 OSS（自动选择内网客户端上传，返回公网 URL）
 * 适用于应用部署在阿里云内网（ECS、函数计算等），可节省流量成本。
 *
 * @param fileBuffer - 文件 Buffer
 * @param fileName   - 原始文件名（用于生成存储路径）
 * @returns 公网可访问的 URL、对象名、文件大小
 */
export async function uploadImage(fileBuffer: Buffer, fileName: string): Promise<UploadResult> {
  const safeName = sanitizeFileName(fileName)
  const ext = safeName.includes('.') ? '' : '.png'
  const key = `records/${Date.now()}_${safeName}${ext}`

  const client = getInternalClient()
  const start = Date.now()
  try {
    const result = await client.put(key, fileBuffer) // result 类型自动推断

    // 将内网 URL 替换为公网 URL（若没有 -internal 则不变）
    const publicUrl = result.url.replace('-internal.aliyuncs.com', '.aliyuncs.com')

    void logCloudServiceCall({
      service: 'oss',
      operation: 'uploadImage',
      success: true,
      durationMs: Date.now() - start,
    })
    return {
      url: publicUrl,
      name: result.name,
      size: fileBuffer.length,
    }
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error)
    void logCloudServiceCall({
      service: 'oss',
      operation: 'uploadImage',
      success: false,
      durationMs: Date.now() - start,
      errorMessage: errMsg.substring(0, 500),
    })
    throw error
  }
}

/**
 * 上传文件到 OSS（按 useInternal 配置选择公网/内网客户端，返回公网 URL）
 *
 * bucket 开启「阻止公共访问」：对象级 public-read ACL 会被服务端拒绝
 * （"Put public object acl is not allowed"），因此头像与材料/录音统一走签名 URL 访问，
 * 上传恒定私有写入，不再设置任何 ACL。
 *
 * @param fileBuffer - 文件 Buffer
 * @param fileName   - 原始文件名
 * @param keyPrefix  - 对象 key 前缀（默认 'records/' 保持既有调用方行为，头像等场景可传 'avatars/'）
 * @returns 公网 URL、对象名、文件大小
 */
export async function uploadImagePublic(
  fileBuffer: Buffer,
  fileName: string,
  keyPrefix: string = 'records/',
  requestId?: string | null,
): Promise<UploadResult> {
  const safeName = sanitizeFileName(fileName)
  const ext = safeName.includes('.') ? '' : '.png'
  const key = `${keyPrefix}${Date.now()}_${safeName}${ext}`

  const client = getUploadClient()
  const start = Date.now()
  try {
    const result = await client.put(key, fileBuffer)

    // 公网归一化：useInternal=true 时走内网 endpoint 上传省流量费，但返回的 url 是
    // *-internal.aliyuncs.com 内网域名，落库后浏览器无法访问，必须替换为公网域名（无 -internal 时不变）
    const publicUrl = result.url.replace('-internal.aliyuncs.com', '.aliyuncs.com')

    void logCloudServiceCall({
      service: 'oss',
      operation: 'uploadImagePublic',
      requestId: requestId ?? null,
      success: true,
      durationMs: Date.now() - start,
    })
    return {
      url: publicUrl,
      name: result.name,
      size: fileBuffer.length,
    }
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error)
    void logCloudServiceCall({
      service: 'oss',
      operation: 'uploadImagePublic',
      requestId: requestId ?? null,
      success: false,
      durationMs: Date.now() - start,
      errorMessage: errMsg.substring(0, 500),
    })
    throw error
  }
}

// ---------- 签名链接常量与辅助函数 ----------

/** 材料音频签名有效期（秒）= 35 分钟 */
export const MATERIAL_EXPIRE = 2100

/** 头像签名有效期（秒）= 35 分钟，与材料音频一致 */
export const AVATAR_EXPIRE = 2100

/** 单词音频签名有效期（秒）= 35 分钟 */
export const WORD_EXPIRE = 2100

/** 用户录音签名有效期（秒）= 40 分钟 */
export const RECORDING_EXPIRE = 2400

/**
 * 为音频 URL 生成临时签名链接
 * 仅对 https:// 开头的 OSS URL 签名，本地路径原样返回
 */
export async function signAudioUrl(
  url: string | null,
  expires: number = MATERIAL_EXPIRE,
): Promise<string | null> {
  if (!url) return null
  if (!url.startsWith('https://')) return url
  return signUrl(url, expires)
}

/**
 * 头像签名包装：null 安全。DB 中 avatarUrl 存完整公网 URL（存量）或裸 key（未来），
 * signUrl 两种入参均兼容且失败时降级返回原串。
 */
export async function signAvatarUrl(avatarUrl: string | null): Promise<string | null> {
  if (!avatarUrl) return null
  return signUrl(avatarUrl, AVATAR_EXPIRE)
}

// ---------- 自定义 key 上传 ----------

/**
 * 使用自定义 key 上传文件到 OSS（按 useInternal 配置选择公网/内网客户端）
 * 适用于迁移等需要精确控制存储路径的场景
 */
export async function uploadWithKey(fileBuffer: Buffer, ossKey: string): Promise<UploadResult> {
  const client = getUploadClient()
  const start = Date.now()
  try {
    const result = await client.put(ossKey, fileBuffer)
    logger.info(`[OSS] 上传成功: ${ossKey} (${fileBuffer.length}B)`)
    fileLog('oss', 'info', `[OSS] 上传成功: ${ossKey}`, { size: fileBuffer.length })
    void logCloudServiceCall({
      service: 'oss',
      operation: 'uploadWithKey',
      success: true,
      durationMs: Date.now() - start,
    })
    return {
      url: result.url,
      name: result.name,
      size: fileBuffer.length,
    }
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error)
    logger.error(`[OSS] 上传失败: ${ossKey}, 错误: ${errMsg}`)
    fileLogError('oss', `[OSS] 上传失败: ${ossKey}`, errMsg)
    void logCloudServiceCall({
      service: 'oss',
      operation: 'uploadWithKey',
      success: false,
      durationMs: Date.now() - start,
      errorMessage: errMsg.substring(0, 500),
    })
    throw error
  }
}

// ---------- 核心功能：下载（上传音频重处理复用） ----------
/**
 * 下载 OSS 对象为 Buffer（供重处理复用上传音频等场景）。
 * 失败抛错（由调用方决定失败语义），埋点风格对齐 uploadWithKey。
 * @param ossKey 对象 key
 */
export async function downloadObject(ossKey: string): Promise<Buffer> {
  const client = getUploadClient()
  const start = Date.now()
  try {
    const result = await client.get(ossKey)
    const content = result.content as Buffer
    logger.info(`[OSS] 下载成功: ${ossKey} (${content.length}B)`)
    fileLog('oss', 'info', `[OSS] 下载成功: ${ossKey}`, { size: content.length })
    void logCloudServiceCall({
      service: 'oss',
      operation: 'downloadObject',
      success: true,
      durationMs: Date.now() - start,
    })
    return content
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error)
    logger.error(`[OSS] 下载失败: ${ossKey}, 错误: ${errMsg}`)
    fileLogError('oss', `[OSS] 下载失败: ${ossKey}`, errMsg)
    void logCloudServiceCall({
      service: 'oss',
      operation: 'downloadObject',
      success: false,
      durationMs: Date.now() - start,
      errorMessage: errMsg.substring(0, 500),
    })
    throw error
  }
}

// ---------- 核心功能：删除（孤儿清理） ----------
/**
 * 删除 OSS 对象（best-effort，用于「先传 OSS 后写库」事务失败后清理孤儿文件）。
 * 失败仅记录日志、不抛错——清理是补偿动作，绝不影响主流程的错误返回。
 * @param ossKey 对象 key
 */
export async function deleteObject(ossKey: string): Promise<void> {
  const client = getUploadClient()
  const start = Date.now()
  try {
    await client.delete(ossKey)
    logger.info(`[OSS] 删除成功: ${ossKey}`)
    fileLog('oss', 'info', `[OSS] 删除成功: ${ossKey}`)
    void logCloudServiceCall({
      service: 'oss',
      operation: 'deleteObject',
      success: true,
      durationMs: Date.now() - start,
    })
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error)
    logger.error(`[OSS] 删除失败: ${ossKey}, 错误: ${errMsg}`)
    fileLogError('oss', `[OSS] 删除失败: ${ossKey}`, errMsg)
    void logCloudServiceCall({
      service: 'oss',
      operation: 'deleteObject',
      success: false,
      durationMs: Date.now() - start,
      errorMessage: errMsg.substring(0, 500),
    })
    // best-effort：不抛错
  }
}

// ---------- 核心功能：签名链接 ----------
/**
 * 生成临时签名 URL（V4 签名），用于私有文件的临时授权访问。
 *
 * @param rawUrl       - 完整的 OSS URL 或对象路径（如 'records/123.png'）
 * @param expires      - 有效期（秒），默认 1800（30 分钟），最长 604800（7 天）
 * @param useInternal  - 是否使用内网 endpoint 生成签名（默认 false）
 * @param queries      - 额外查询参数，如图片处理 `{ 'x-oss-process': 'image/resize,w_100' }`
 * @returns 签名后的完整 URL
 */
export async function signUrl(
  rawUrl: string,
  expires: number = 1800,
  useInternal: boolean = false,
  queries: Record<string, string> = {},
): Promise<string> {
  try {
    // 提取对象 key
    const idx = rawUrl.indexOf('.aliyuncs.com/')
    let key: string
    if (idx !== -1) {
      key = rawUrl.substring(idx + '.aliyuncs.com/'.length).split('?')[0] ?? ''
    } else {
      key = rawUrl
    }
    const decodedKey = decodeURIComponent(key)

    const client = useInternal ? getInternalClient() : getClient()

    // 使用 V4 签名方法（类型已由 @types/ali-oss 提供）
    const signedUrl = await client.signatureUrlV4(
      'GET',
      expires,
      {
        headers: {},
        queries,
      },
      decodedKey,
    )

    // logger.log(`[OSS] signUrl 成功: ${rawUrl} → ${signedUrl} (${useInternal ? '内网' : '公网'})`)
    logger.log(`[OSS] signUrl 成功: ${rawUrl} (${useInternal ? '内网' : '公网'})`)
    fileLog('oss', 'info', `[OSS] signUrl 成功: ${rawUrl} (${useInternal ? '内网' : '公网'})`)
    return signedUrl
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error)
    logger.error(`[OSS] signUrl 失败: ${rawUrl}, 错误: ${errMsg}`)
    fileLogError('oss', `[OSS] signUrl 失败: ${rawUrl}`, errMsg)
    return rawUrl // 降级
  }
}

// ---------- 通用上传功能 ----------

/**
 * 通用文件上传（使用内网客户端，自动转公网 URL）
 * 适用于图片、音频、视频等任意类型文件，上传到 OSS 的 records/ 目录下。
 *
 * @param fileBuffer - 文件 Buffer
 * @param fileName   - 原始文件名（用于生成存储路径和扩展名）
 * @returns 公网 URL、对象名、文件大小
 */
export async function uploadFile(fileBuffer: Buffer, fileName: string): Promise<UploadResult> {
  const safeName = sanitizeFileName(fileName)
  // 保留原有扩展名（如果有），否则默认 .bin（根据实际需求可自行修改）
  const ext = safeName.includes('.') ? '' : '.bin'
  const key = `records/${Date.now()}_${safeName}${ext}`

  const client = getInternalClient()
  const result = await client.put(key, fileBuffer)

  const publicUrl = result.url.replace('-internal.aliyuncs.com', '.aliyuncs.com')

  return {
    url: publicUrl,
    name: result.name,
    size: fileBuffer.length,
  }
}

/**
 * 通用文件上传（使用公网客户端）
 * 适用于非阿里云内网环境，支持图片、音频等任意类型文件。
 *
 * @param fileBuffer - 文件 Buffer
 * @param fileName   - 原始文件名
 * @returns 公网 URL、对象名、文件大小
 */
export async function uploadFilePublic(
  fileBuffer: Buffer,
  fileName: string,
): Promise<UploadResult> {
  const safeName = sanitizeFileName(fileName)
  const ext = safeName.includes('.') ? '' : '.bin'
  const key = `records/${Date.now()}_${safeName}${ext}`

  const client = getClient()
  const result = await client.put(key, fileBuffer)

  return {
    url: result.url,
    name: result.name,
    size: fileBuffer.length,
  }
}

/**
 * 获取 Bucket 存储统计（官方 GetBucketStat API）。
 * 失败（权限不足 / bucket 不支持 / 网络异常）时返回 success=false + error，绝不抛异常。
 *
 * 注意：@types/ali-oss 缺少 getBucketStat 类型声明，运行时 SDK 已支持（6.18.0+），
 * 此处使用受控 cast。数据延迟可能超过 1 小时，不含流量数据。
 */
export async function getOssBucketStat(): Promise<OssBucketStat> {
  try {
    const c = getUploadClient()
    const bucket = config.bucket
    // @ts-expect-error ali-oss SDK 运行时支持 getBucketStat，但类型定义缺失
    const res = await c.getBucketStat(bucket)
    const stat = res?.stat
    if (!stat) {
      return { success: false, error: 'OSS 响应结构异常（无 stat 字段）' }
    }
    const result: OssBucketStat = {
      success: true,
      storage: Number(stat.Storage ?? 0),
      objectCount: Number(stat.ObjectCount ?? 0),
      standardStorage: Number(stat.StandardStorage ?? 0),
      standardObjectCount: Number(stat.StandardObjectCount ?? 0),
      multipartUploadCount: Number(stat.MultipartUploadCount ?? 0),
      lastModifiedTime: Number(stat.LastModifiedTime ?? 0),
      infrequentAccessStorage: Number(stat.InfrequentAccessStorage ?? 0),
      infrequentAccessObjectCount: Number(stat.InfrequentAccessObjectCount ?? 0),
      archiveStorage: Number(stat.ArchiveStorage ?? 0),
      archiveObjectCount: Number(stat.ArchiveObjectCount ?? 0),
      coldArchiveStorage: Number(stat.ColdArchiveStorage ?? 0),
      coldArchiveObjectCount: Number(stat.ColdArchiveObjectCount ?? 0),
      deepColdArchiveStorage: Number(stat.DeepColdArchiveStorage ?? 0),
      deepColdArchiveObjectCount: Number(stat.DeepColdArchiveObjectCount ?? 0),
    }
    fileLog('oss', 'info', '[getOssBucketStat] 查询成功', {
      storage: result.storage,
      objectCount: result.objectCount,
    })
    return result
  } catch (err) {
    const e = err as { code?: string; message?: string }
    logger.error('[oss] getBucketStat 失败:', err)
    fileLogError(
      'oss',
      '[getOssBucketStat] 失败',
      e?.code ? `${e.code}: ${e.message ?? ''}` : String(err),
    )
    return {
      success: false,
      error: e?.code ? `${e.code}: ${e.message ?? ''}` : String(err),
    }
  }
}
