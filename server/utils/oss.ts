import OSS from 'ali-oss'
import type { Options } from 'ali-oss'


/** 上传成功后的返回结构 */
export interface UploadResult {
  /** 公网可访问的 URL（已自动将内网域名替换为公网） */
  url: string;
  /** OSS 对象名（即 key） */
  name: string;
  /** 文件大小（字节） */
  size: number;
}

/** 配置对象结构（用于强约束 config.oss） */
interface OssConfig {
  region: string;
  bucket: string;
  accessKeyId: string;
  accessKeySecret: string;
}

let client: OSS | null = null;
let internalClient: OSS | null = null;
const config:OssConfig = useRuntimeConfig().oss


function buildOssOptions(options: Partial<Options> = {}):Options {
    const baseOptions:Options =  {
        ...config,
        secure: true, // 使用 HTTPS
        authorizationV4: true, 
    }
    const finalOptions = { ...baseOptions, ...options };
    if (!finalOptions.endpoint) {
        // 自动构造标准 Endpoint
        const internalSuffix = finalOptions.internal ? '-internal' : '';
        finalOptions.endpoint = `https://${config.region}${internalSuffix}.aliyuncs.com`;
    }
    return finalOptions;
}

/**
 * 获取公网客户端（单例模式）
 * 用于生成公网签名链接、外部访问等
 */
function getClient(): OSS {
  if (!client) {
    client = new OSS(buildOssOptions());
  }
  return client;
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
      })
    );
  }
  return internalClient;
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
      .replace(/[^\x00-\x7F]/g, '') // 移除非 ASCII 字符（中文、emoji 等）
      .trim()
      .replace(/\s+/g, '_') // 连续空格转单下划线
      .replace(/[^a-zA-Z0-9._-]/g, '') // 只保留字母数字 . _ -
      || 'image'
  );
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
  const safeName = sanitizeFileName(fileName);
  const ext = safeName.includes('.') ? '' : '.png';
  const key = `records/${Date.now()}_${safeName}${ext}`;

  const client = getInternalClient();
  const result = await client.put(key, fileBuffer); // result 类型自动推断

  // 将内网 URL 替换为公网 URL（若没有 -internal 则不变）
  const publicUrl = result.url.replace('-internal.aliyuncs.com', '.aliyuncs.com');

  return {
    url: publicUrl,
    name: result.name,
    size: fileBuffer.length,
  };
}

/**
 * 上传文件到 OSS（使用公网客户端）
 * 适用于非阿里云内网环境，或需要强制公网访问的场景。
 * 
 * @param fileBuffer - 文件 Buffer
 * @param fileName   - 原始文件名
 * @returns 公网 URL、对象名、文件大小
 */
export async function uploadImagePublic(fileBuffer: Buffer, fileName: string): Promise<UploadResult> {
  const safeName = sanitizeFileName(fileName);
  const ext = safeName.includes('.') ? '' : '.png';
  const key = `records/${Date.now()}_${safeName}${ext}`;

  const client = getClient(); // 使用公网客户端
  const result = await client.put(key, fileBuffer);

  // 公网客户端返回的 url 本身就是公网地址，无需替换
  return {
    url: result.url,
    name: result.name,
    size: fileBuffer.length,
  };
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
  queries: Record<string, string> = {}
): Promise<string> {
  try {
    // 提取对象 key
    const idx = rawUrl.indexOf('.aliyuncs.com/');
    let key: string
    if (idx !== -1) {
      key = rawUrl.substring(idx + '.aliyuncs.com/'.length).split('?')[0] ?? ''
    } else {
      key = rawUrl
    }
    const decodedKey = decodeURIComponent(key)

    const client = useInternal ? getInternalClient() : getClient();

    // 使用 V4 签名方法（类型已由 @types/ali-oss 提供）
    const signedUrl = await client.signatureUrlV4(
      'GET',
      expires,
      {
        headers: {},
        queries,
      },
      decodedKey
    );

    console.log(`[OSS] signUrl 成功: ${rawUrl} → ${signedUrl} (${useInternal ? '内网' : '公网'})`);
    return signedUrl;
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error(`[OSS] signUrl 失败: ${rawUrl}, 错误: ${errMsg}`);
    return rawUrl; // 降级
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
  const safeName = sanitizeFileName(fileName);
  // 保留原有扩展名（如果有），否则默认 .bin（根据实际需求可自行修改）
  const ext = safeName.includes('.') ? '' : '.bin';
  const key = `records/${Date.now()}_${safeName}${ext}`;

  const client = getInternalClient();
  const result = await client.put(key, fileBuffer);

  const publicUrl = result.url.replace('-internal.aliyuncs.com', '.aliyuncs.com');

  return {
    url: publicUrl,
    name: result.name,
    size: fileBuffer.length,
  };
}

/**
 * 通用文件上传（使用公网客户端）
 * 适用于非阿里云内网环境，支持图片、音频等任意类型文件。
 * 
 * @param fileBuffer - 文件 Buffer
 * @param fileName   - 原始文件名
 * @returns 公网 URL、对象名、文件大小
 */
export async function uploadFilePublic(fileBuffer: Buffer, fileName: string): Promise<UploadResult> {
  const safeName = sanitizeFileName(fileName);
  const ext = safeName.includes('.') ? '' : '.bin';
  const key = `records/${Date.now()}_${safeName}${ext}`;

  const client = getClient();
  const result = await client.put(key, fileBuffer);

  return {
    url: result.url,
    name: result.name,
    size: fileBuffer.length,
  };
}