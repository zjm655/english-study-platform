// server/api/user/register.post.ts
import { query, pool } from '#server/utils/db'
import { registerSchema } from '#shared/schemas/user'
import type { RegisterPayload } from '#shared/types/user'
import type { ZodSafeParseResult } from 'zod'
import type { ResPayload } from '#shared/types/request'
import type { UserRow } from '#server/types/db'
import type { ResultSetHeader } from 'mysql2'
import bcrypt from 'bcryptjs'

/**
 * 注册接口：校验参数 → 检查唯一性 → 密码加密 → 写入数据库
 * 请求：POST /api/user/register
 * Body：{ account, password1, password2, nickname?, email? }
 */
export default defineEventHandler(async (event): Promise<ResPayload<null>> => {
  // 1. 读取请求体
  const body: RegisterPayload = await readBody(event)

  // 2. zod 校验
  const result: ZodSafeParseResult<RegisterPayload> = registerSchema.safeParse(body)

  if (!result.success) {
    const errorMessage = result.error?.issues[0]?.message || '参数校验失败'
    return validateError(errorMessage)
  }

  const { account, password1, nickname, email, captchaToken, captchaCode } = result.data

  // 2b. 图形验证码校验（防止脚本批量注册）
  const captchaOk = await verifyCaptcha(captchaToken, captchaCode)
  if (!captchaOk) {
    return validateError('图形验证码错误')
  }

  // 3. 检查账号是否已存在
  const accountRows = await query<UserRow>('SELECT id FROM user WHERE account = ?', [account])
  if (accountRows.length > 0) {
    return validateError('该账号已注册，请直接登录')
  }

  // 4. 如果填了邮箱，检查邮箱是否已绑定
  if (email) {
    const emailRows = await query<UserRow>('SELECT id FROM user WHERE email = ?', [email])
    if (emailRows.length > 0) {
      return validateError('该邮箱已绑定其他账号')
    }
  }

  // 5. 密码加密
  const passwordHash = await bcrypt.hash(password1, 10)

  // 6. 写入数据库：若带未合并的游客 cookie → 同行转正（保留其已有学习数据，零迁移）；否则新建
  const guestKey = await readGuestKey(event)
  let promoted = false
  let promotedGuestId: number | null = null
  if (guestKey) {
    const guestRows = await query<{ id: number }>(
      'SELECT id FROM user WHERE guest_key = ? AND is_guest = 1 AND merged_into_user_id IS NULL',
      [guestKey],
    )
    const guestRow = guestRows[0]
    if (guestRow) {
      // 转正时同步清除 guest_key，避免残留游客标识；AND is_guest = 1 + merged/deleted 守卫防止并发竞争
      const [updateResult] = await pool.execute<ResultSetHeader>(
        'UPDATE user SET account = ?, passwordHash = ?, nickname = ?, email = ?, is_guest = 0, guest_key = NULL WHERE id = ? AND is_guest = 1 AND merged_into_user_id IS NULL AND deleted_at IS NULL',
        [account, passwordHash, nickname || null, email || null, guestRow.id],
      )
      // affectedRows 为 0 说明被并发请求抢先转正/合并，跳过转正走正常新建流程
      if (updateResult.affectedRows > 0) {
        // 纵深防御：回读确认未被并发合并标记（防御性，理论上 affectedRows>0 已保证）
        const verifyRows = await pool.execute('SELECT deleted_at FROM user WHERE id = ?', [
          guestRow.id,
        ])
        const verifyRow = (verifyRows[0] as Array<{ deleted_at: string | null }>)[0]
        if (verifyRow?.deleted_at) {
          throw new Error('GUEST_PROMOTION_CONFLICT')
        }
        // 游客实体化时已建 stats 行，用 IGNORE 兑底
        await pool.execute('INSERT IGNORE INTO user_checkin_stats (user_id) VALUES (?)', [
          guestRow.id,
        ])
        clearGuestCookie(event)
        promoted = true
        promotedGuestId = guestRow.id
      }
    }
  }

  if (!promoted) {
    const [insertResult] = await pool.execute<ResultSetHeader>(
      'INSERT INTO user (account, passwordHash, nickname, email) VALUES (?, ?, ?, ?)',
      [account, passwordHash, nickname || null, email || null],
    )
    // 为新用户创建打卡统计记录
    await pool.execute('INSERT INTO user_checkin_stats (user_id) VALUES (?)', [
      insertResult.insertId,
    ])
  }

  // 转正成功后，清理游客限流内存缓存中的残留条目（防止内存泄漏）
  if (promotedGuestId != null) {
    const { invalidateGuestAudioLimitCache } = await import('#server/utils/guestOssLimit')
    const { invalidateGuestEvalLimitCache } = await import('#server/utils/guestEvalLimit')
    invalidateGuestAudioLimitCache()
    invalidateGuestEvalLimitCache()

    // 转正后合并指纹孤儿行数据（历史双通道产生的另一个游客行）
    const fingerprint = getRequestHeader(event, 'x-guest-fingerprint')
    if (fingerprint && /^[a-f0-9]{64}$/.test(fingerprint)) {
      try {
        const { mergeFingerprintOrphan } = await import('#server/services/guestMerge')
        await mergeFingerprintOrphan(fingerprint, promotedGuestId)
      } catch (err) {
        logger.error('[register] 指纹孤儿行合并失败:', err)
      }
    }
  }

  // 8. 返回成功
  return validateSuccess(null, '注册成功！')
})
