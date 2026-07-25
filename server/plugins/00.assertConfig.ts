// server/plugins/00.assertConfig.ts
// 启动期配置断言：确保关键运行时配置（尤其 jwtSecret）已正确注入。
//
// 为什么用 00. 前缀：Nitro plugins 按文件名排序执行，前缀确保本插件最先运行，
// 在任何请求进入前完成校验。
//
// 空/弱 JWT 密钥的危害：jose 对零长度 HMAC 密钥会抛错（登录不可用）；若被绕过则
// token 可被伪造越权。生产环境必须硬失败（拒绝启动）；开发环境为保证可运行注入
// 固定占位密钥，但打印醒目告警提醒配置真实强密钥。

const MIN_SECRET_LENGTH = 32
/** 开发环境占位密钥（长度 ≥ MIN_SECRET_LENGTH），仅用于本地可运行，绝不用于生产 */
const DEV_PLACEHOLDER_SECRET = 'dev-only-insecure-jwt-secret-change-me!!'

export default defineNitroPlugin(() => {
  const config = useRuntimeConfig()
  const fatalProblems: string[] = []

  // 1. JWT 密钥：非空且长度 ≥ 32
  const jwtSecret = config.jwtSecret
  if (!jwtSecret || jwtSecret.length < MIN_SECRET_LENGTH) {
    if (import.meta.dev) {
      // 开发环境：注入占位密钥保证 jose 可用，但强烈告警
      try {
        config.jwtSecret = DEV_PLACEHOLDER_SECRET
      } catch {
        /* runtimeConfig 只读时忽略；开发者需自行配置 NUXT_JWT_SECRET */
      }
      logger.warn(
        `[assertConfig] ⚠️ NUXT_JWT_SECRET 未配置或长度不足 ${MIN_SECRET_LENGTH}，已注入开发占位密钥。生产环境必须在 .env 配置强密钥！`,
      )
    } else {
      fatalProblems.push(`NUXT_JWT_SECRET 缺失或长度不足（要求 ≥ ${MIN_SECRET_LENGTH} 字符）`)
    }
  }

  // 2. 数据库关键配置：缺失则无法提供任何服务，硬失败
  if (!config.db?.host || !config.db?.database) {
    fatalProblems.push('数据库配置不完整（NUXT_DB_HOST / NUXT_DB_DATABASE）')
  }

  // 3. OSS 关键配置：缺失仅告警（本地开发可能暂不需要音频功能）
  if (!config.oss?.accessKeyId || !config.oss?.accessKeySecret || !config.oss?.bucket) {
    logger.warn('[assertConfig] ⚠️ OSS 配置不完整，音频上传 / 签名功能将不可用')
  }

  if (fatalProblems.length > 0) {
    const msg = `[assertConfig] 致命：关键运行时配置缺失，拒绝启动：\n - ${fatalProblems.join('\n - ')}`
    logger.error(msg)
    throw new Error(msg)
  }

  logger.info('[assertConfig] 运行时关键配置校验通过')
})
