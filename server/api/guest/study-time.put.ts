import { randomUUID } from 'node:crypto'
import { withTransaction } from '#server/utils/db'
import { getClientIp } from '#server/utils/clientIp'
import { readGuestKey, setGuestCookie } from '#server/utils/guest'
import { checkGuestKeyIssue } from '#server/utils/guestIpGuard'
import { ensureGuestUser, getGuestDailyStudyCap } from '#server/services/guestUser'
import { accumulateStudyTime } from '#server/services/studyTime'
import { studyTimeSchema } from '#shared/schemas/user'
import type { GuestStudyResult } from '#shared/types/user'
import type { ZodSafeParseResult } from 'zod'

/**
 * 游客学习时长上报（一期唯一游客写端点，中间件白名单放行）
 * 请求：PUT /api/guest/study-time  Body：{ studySeconds: number }
 *
 * 职责合一（省额外 session 端点）：
 * 1. 无/坏 cookie → 懒签发新 guest_token（不落库）
 * 2. studySeconds<=0（挂载基准报文）→ 不落库（延迟落库门槛，爬虫/无痕零 DB 成本）
 * 3. 正数上报 → 懒实体化 user 行 + 累计时长（带单日封顶）
 * 不设 event.context.user，保护 apiCallLog user_id 口径与 activeUsers 统计。
 */
export default defineEventHandler(async (event): Promise<ResPayload<GuestStudyResult | null>> => {
  // 登录用户误调（其正常走 /api/user/study-time）→ 空操作
  if (event.context.user) return validateSuccess(null, 'ok')

  const body = await readBody(event)
  const parsed: ZodSafeParseResult<{ studySeconds: number }> = studyTimeSchema.safeParse(body)
  if (!parsed.success) {
    return validateError(parsed.error?.issues[0]?.message || '参数校验失败')
  }
  const studySeconds = parsed.data.studySeconds

  let guestKey = await readGuestKey(event)

  // 无身份 → 懒签发；无论如何 <=0 秒都不落库
  if (!guestKey) {
    // P3-C：铸键频率限制（1 次/分/IP）——guest_token 免费签发是身份轮换的供给侧，防脚本批量铸键
    if (!(await checkGuestKeyIssue(getClientIp(event)))) {
      return validateError('操作过于频繁，请稍后再试', 429)
    }
    guestKey = randomUUID()
    await setGuestCookie(event, guestKey)
  }
  if (studySeconds <= 0) {
    return validateSuccess({ guestDisplayId: guestKey.slice(0, 8), stats: null }, 'ok')
  }

  // 正数上报 → 实体化 + 累计（带单日封顶）
  const cap = await getGuestDailyStudyCap()
  const stats = await withTransaction(async (conn) => {
    const ensured = await ensureGuestUser(conn, guestKey!)
    if (ensured.conflict) return null // 残留（已合并）cookie，本轮不落库
    return accumulateStudyTime(conn, ensured.userId, studySeconds, { dailyCapSeconds: cap })
  })

  // 残留 cookie → 换发全新 key（下轮起干净），本轮不落库
  if (stats === null) {
    const fresh = randomUUID()
    await setGuestCookie(event, fresh)
    return validateSuccess({ guestDisplayId: fresh.slice(0, 8), stats: null }, 'ok')
  }

  return validateSuccess({ guestDisplayId: guestKey.slice(0, 8), stats }, 'ok')
})
