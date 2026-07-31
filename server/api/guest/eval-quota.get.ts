/**
 * GET /api/guest/eval-quota
 *
 * 游客评测配额查询：返回当日配音/影子跟读各阶段已用次数与上限。
 * 中间件白名单放行（需携带 guest_token cookie），handler 内解析游客身份。
 * 登录用户误调返回空数据（不报错）。
 */
import { readGuestKey } from '#server/utils/guest'
import { getGuestEvalQuota } from '#server/utils/guestEvalLimit'

export default defineEventHandler(
  async (
    event,
  ): Promise<
    ResPayload<{
      dubbing: { used: number; limit: number }
      shadow: { used: number; limit: number }
    }>
  > => {
    // 登录用户无需查询游客配额
    if (event.context.user) {
      return validateSuccess({ dubbing: { used: 0, limit: 0 }, shadow: { used: 0, limit: 0 } })
    }

    const guestKey = await readGuestKey(event)
    if (!guestKey) {
      return validateError('未识别到游客身份', 401)
    }

    const quota = await getGuestEvalQuota(guestKey)
    return validateSuccess(quota)
  },
)
