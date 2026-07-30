// server/plugins/01.seedSuperAdmin.ts
// 启动期自举全局唯一超级管理员：读 runtimeConfig.superAdmin（env 注入）→ 调 seedSuperAdmin。
//
// 为什么用 01. 前缀：排在 00.assertConfig（配置断言）之后，确保关键运行时配置已校验。
// opt-in：account/password 任一为空则跳过（纯前端开发者不配 env 即无感）。
// fail-fast：DB 未就绪 / 配置非法 / 账号占用 → seedSuperAdmin 抛错，此处不捕获，冒泡中止启动。
import { seedSuperAdmin } from '#server/services/seedSuperAdmin'

export default defineNitroPlugin(async () => {
  const sa = useRuntimeConfig().superAdmin as
    | {
        account?: string | number
        password?: string | number
        nickname?: string | number
        email?: string | number
        forceReplace?: string | number | boolean
      }
    | undefined

  // opt-in 开关：未配置账号/密码 → 不启用自举（env 经 destr 可能为 number，先 String 归一再判断）
  const account = String(sa?.account ?? '').trim()
  const password = String(sa?.password ?? '')
  if (!account || !password) return

  // forceReplace 经 destr 可能是布尔 true / 字符串 'true' / 数字 1，统一视为开启
  const forceReplace =
    sa?.forceReplace === true ||
    sa?.forceReplace === 'true' ||
    sa?.forceReplace === 1 ||
    sa?.forceReplace === '1'
  const result = await seedSuperAdmin({
    account,
    password,
    nickname: sa?.nickname,
    email: sa?.email,
    forceReplace,
  })

  switch (result.status) {
    case 'created':
      logger.info(`[seedSuperAdmin] 已自举超级管理员（account=${account}, id=${result.userId}）`)
      break
    case 'replaced':
      logger.warn(
        `[seedSuperAdmin] 已按 FORCE_REPLACE 替换超管：降级 [${result.demotedIds.join(', ')}]，新超管 id=${result.userId}`,
      )
      break
    case 'skipped-conflict':
      logger.warn(
        `[seedSuperAdmin] ⚠️ 已存在超管 [${result.existingAccounts.join(', ')}] 与目标 account=${account} 不一致；未设 NUXT_SUPER_ADMIN_FORCE_REPLACE，跳过自举。如需切换请显式开启该开关。`,
      )
      break
    case 'exists':
      logger.info('[seedSuperAdmin] 超级管理员已存在，跳过自举')
      break
  }
})
