// server/services/seedSuperAdmin.ts
// 启动期「按环境变量自举全局唯一超级管理员」的核心逻辑。
// 与插件（server/plugins/01.seedSuperAdmin.ts）分离，便于 mock db 做单元测试。
//
// 设计要点：
// - bootstrap 是超管状态的唯一权威：无超管→建新；已存在目标超管→幂等跳过；
//   存在异账号超管→未开 forceReplace 跳过、开了则「同事务原子降旧+立新+留痕」。
// - 与迁移 018「升首个管理员为超管」的遗留冲突，正是「异账号超管」分支，交由 forceReplace 消化，
//   绝不再写降级迁移（盲跑迁移会造成「零超管」锁死授权管理）。
// - account 被占用一律拒绝（抛错）；读 user 表失败（未迁移/连不上）抛错 → 由插件冒泡中止启动。
import bcrypt from 'bcrypt'
import type { PoolConnection, ResultSetHeader } from 'mysql2/promise'
import { query, withTransaction } from '#server/utils/db'
import { ROLE_ADMIN, ROLE_SUPER_ADMIN } from '#shared/utils/role'

/** bcrypt cost：与注册/登录保持一致，确保 bcrypt.compare 兼容 */
const BCRYPT_COST = 10
/** 密码最小长度（自举超管弱口令风险高，强制下限） */
const MIN_PASSWORD_LENGTH = 8
/** account 列长度上限（对齐 user.account varchar(20)） */
const MAX_ACCOUNT_LENGTH = 20

export interface SuperAdminSeedConfig {
  // 来自 runtimeConfig/env：Nuxt 会用 destr 解析，纯数字账号/密码会被转成 number，
  // 故放宽入参类型并在内部统一 String() 归一，避免 .trim() 崩溃。
  account: string | number
  password: string | number
  nickname?: string | number | null
  email?: string | number | null
  forceReplace?: boolean
}

export type SeedResult =
  | { status: 'created'; userId: number }
  | { status: 'exists' }
  | { status: 'skipped-conflict'; existingAccounts: string[] }
  | { status: 'replaced'; userId: number; demotedIds: number[] }

/**
 * 自举全局唯一超级管理员。调用方（插件）须已确保 account/password 非空（opt-in 开关）。
 * 返回结果供插件记录日志；不合法配置 / 账号占用 / DB 未就绪均抛错以中止启动（fail-fast）。
 */
export async function seedSuperAdmin(cfg: SuperAdminSeedConfig): Promise<SeedResult> {
  // env 值经 Nuxt destr 解析，纯数字会变成 number；统一 String() 归一，避免 .trim() 崩溃
  const account = String(cfg.account ?? '').trim()
  const password = String(cfg.password ?? '')
  const nickname = String(cfg.nickname ?? '').trim() || account
  const email = String(cfg.email ?? '').trim() || null

  // 1. 配置校验（不合法即视为部署错误，fail-fast）
  if (!account || account.length > MAX_ACCOUNT_LENGTH) {
    throw new Error(
      `[seedSuperAdmin] NUXT_SUPER_ADMIN_ACCOUNT 非法（非空且 ≤ ${MAX_ACCOUNT_LENGTH} 字符）`,
    )
  }
  if (!password || password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(
      `[seedSuperAdmin] NUXT_SUPER_ADMIN_PASSWORD 太弱（要求 ≥ ${MIN_PASSWORD_LENGTH} 位）`,
    )
  }

  // 2. 读现存超管；此读失败=DB 未就绪（未迁移/连不上），抛出以中止启动
  let supers: { id: number; account: string }[]
  try {
    supers = await query<{ id: number; account: string }>(
      'SELECT id, account FROM `user` WHERE role = ? AND deleted_at IS NULL',
      [ROLE_SUPER_ADMIN],
    )
  } catch (e) {
    throw new Error(
      `[seedSuperAdmin] 无法读取 user 表（数据库不可用或未迁移，请先运行 npm run migrate）：${(e as Error).message}`,
      { cause: e },
    )
  }

  // 3a. 已存在超管
  if (supers.length > 0) {
    // 目标账号已是超管 → 幂等跳过（日常每次重启走这里）
    if (supers.some((s) => s.account === account)) {
      return { status: 'exists' }
    }
    // 存在异账号超管：未显式开启替换 → 跳过（绝不造双超管、绝不擅自摧毁）
    if (!cfg.forceReplace) {
      return { status: 'skipped-conflict', existingAccounts: supers.map((s) => s.account) }
    }
    // forceReplace：目标 account 不得被他人占用（异账号超管不含目标 account）
    await assertAccountAvailable(account)
    const hash = await bcrypt.hash(password, BCRYPT_COST)
    const demotedIds = supers.map((s) => s.id)
    const userId = await withTransaction(async (conn) => {
      // 降级现存超管 → 管理员，并逐条留痕
      await conn.execute('UPDATE `user` SET role = ? WHERE role = ? AND deleted_at IS NULL', [
        ROLE_ADMIN,
        ROLE_SUPER_ADMIN,
      ])
      for (const id of demotedIds) {
        await writeBootstrapLog(conn, 'user.role.update', id, {
          before: ROLE_SUPER_ADMIN,
          after: ROLE_ADMIN,
          via: 'superadmin-bootstrap',
        })
      }
      const newId = await insertSuperAdmin(conn, { account, hash, nickname, email })
      await writeBootstrapLog(conn, 'user.superadmin.bootstrap', newId, {
        account,
        mode: 'replace',
        replacedUserIds: demotedIds,
      })
      return newId
    })
    return { status: 'replaced', userId, demotedIds }
  }

  // 3b. 无超管：建新（account 占用则拒绝）
  await assertAccountAvailable(account)
  const hash = await bcrypt.hash(password, BCRYPT_COST)
  try {
    const userId = await withTransaction(async (conn) => {
      const newId = await insertSuperAdmin(conn, { account, hash, nickname, email })
      await writeBootstrapLog(conn, 'user.superadmin.bootstrap', newId, { account, mode: 'create' })
      return newId
    })
    return { status: 'created', userId }
  } catch (e) {
    // 多实例并发启动竞态：另一实例已插入（account 唯一键冲突）→ 视为幂等成功
    if ((e as { code?: string }).code === 'ER_DUP_ENTRY') {
      return { status: 'exists' }
    }
    throw e
  }
}

/** account 被任意用户（含软删/任意角色，唯一键含软删行）占用即抛错 */
async function assertAccountAvailable(account: string): Promise<void> {
  const rows = await query<{ id: number }>('SELECT id FROM `user` WHERE account = ?', [account])
  if (rows.length > 0) {
    throw new Error(
      `[seedSuperAdmin] NUXT_SUPER_ADMIN_ACCOUNT「${account}」已被占用，请改用其他账号或手动处理`,
    )
  }
}

/** 事务内插入超管 + 打卡统计行，返回新用户 id */
async function insertSuperAdmin(
  conn: PoolConnection,
  data: { account: string; hash: string; nickname: string; email: string | null },
): Promise<number> {
  const [ins] = await conn.execute<ResultSetHeader>(
    'INSERT INTO `user` (account, passwordHash, nickname, email, role, status, level) VALUES (?, ?, ?, ?, ?, 1, 0)',
    [data.account, data.hash, data.nickname, data.email, ROLE_SUPER_ADMIN],
  )
  const userId = ins.insertId
  await conn.execute('INSERT INTO user_checkin_stats (user_id) VALUES (?)', [userId])
  return userId
}

/**
 * 事务内直写 admin_operation_log（不用会静默吞错、走独立 pool 的 logAdminOperation），
 * 保证「降级+立新+留痕」原子性。admin_id=NULL 表示系统自举、无人类操作者。
 */
async function writeBootstrapLog(
  conn: PoolConnection,
  action: string,
  targetId: number,
  detail: Record<string, unknown>,
): Promise<void> {
  await conn.execute(
    'INSERT INTO admin_operation_log (admin_id, action, target_type, target_id, detail) VALUES (NULL, ?, ?, ?, ?)',
    [action, 'user', targetId, JSON.stringify(detail)],
  )
}
