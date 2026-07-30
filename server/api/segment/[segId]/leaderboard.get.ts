import { query } from '#server/utils/db'
import { signAvatarUrl } from '#server/utils/oss'
import { validateError, validateSuccess } from '#server/utils/validate'
import { ROLE_ADMIN } from '#shared/utils/role'
import type {
  SegmentLeaderboard,
  SegmentLeaderboardBoard,
  SegmentLeaderboardEntry,
} from '#shared/types/leaderboard'

/** 每阶段榜单规模 */
const TOP_N = 50

/** 账号打码：昵称为空时的回退展示，原始账号不出网 */
export function maskAccount(account: string): string {
  if (account.length <= 4) return `${account.slice(0, 1)}***`
  return `${account.slice(0, 2)}***${account.slice(-2)}`
}

/** mysql2 datetime 返回 Date 对象，统一转 ISO 字符串 */
function toIso(v: Date | string): string {
  return v instanceof Date ? v.toISOString() : String(v)
}

interface BoardRow {
  userId: number
  bestScore: string | number // DECIMAL 驱动返回字符串
  achievedAt: Date | string
  nickname: string | null
  account: string
  avatarUrl: string | null
}

/**
 * 构建单阶段榜单：各用户最佳分 Top50 + 当前用户名次。
 * 口径：recording 表聚合（软删不计入），同分按更早达成排前；
 * 已销号（deleted_at 非空）与封禁（status=0）用户不入榜。
 */
export async function buildBoard(
  segId: number,
  phase: number,
  meId: number,
): Promise<SegmentLeaderboardBoard> {
  const rows = await query<BoardRow>(
    `SELECT b.user_id AS userId, b.best_score AS bestScore, MIN(r.createdAt) AS achievedAt,
            u.nickname, u.account, u.avatarUrl
     FROM (
       SELECT user_id, MAX(score) AS best_score
       FROM recording
       WHERE segment_id = ? AND phase = ? AND score IS NOT NULL AND deleted_at IS NULL
       GROUP BY user_id
     ) b
     JOIN recording r ON r.user_id = b.user_id AND r.segment_id = ? AND r.phase = ?
       AND r.score = b.best_score AND r.deleted_at IS NULL
     JOIN user u ON u.id = b.user_id AND u.deleted_at IS NULL AND u.status = 1
     GROUP BY b.user_id, b.best_score, u.nickname, u.account, u.avatarUrl
     ORDER BY bestScore DESC, achievedAt ASC
     LIMIT ${TOP_N}`,
    [segId, phase, segId, phase],
  )

  const list: SegmentLeaderboardEntry[] = await Promise.all(
    rows.map(async (r, idx) => ({
      rank: idx + 1,
      nickname: r.nickname?.trim() ? r.nickname : maskAccount(r.account),
      avatarUrl: await signAvatarUrl(r.avatarUrl),
      bestScore: Number(r.bestScore),
      achievedAt: toIso(r.achievedAt),
      isMe: r.userId === meId,
    })),
  )

  // 我的名次：榜内直接取行（免额外查询）；榜外单独算最佳分与名次
  const mineIdx = rows.findIndex((r) => r.userId === meId)
  if (mineIdx >= 0) {
    const entry = list[mineIdx]!
    return {
      list,
      me: { rank: entry.rank, bestScore: entry.bestScore, achievedAt: entry.achievedAt },
    }
  }

  const myRows = await query<{ bestScore: string | number; achievedAt: Date | string }>(
    `SELECT r.score AS bestScore, MIN(r.createdAt) AS achievedAt
     FROM recording r
     WHERE r.user_id = ? AND r.segment_id = ? AND r.phase = ?
       AND r.deleted_at IS NULL AND r.score IS NOT NULL
       AND r.score = (
         SELECT MAX(score) FROM recording
         WHERE user_id = ? AND segment_id = ? AND phase = ? AND deleted_at IS NULL AND score IS NOT NULL
       )
     GROUP BY r.score`,
    [meId, segId, phase, meId, segId, phase],
  )
  const mine = myRows[0]
  if (!mine) {
    return { list, me: null }
  }

  const myBest = Number(mine.bestScore)
  // 名次 = 比我强的人数 + 1（更高分，或同分但更早达成）。
  // achievedAt 参数透传驱动返回的原始值（Date）：若转 ISO 字符串（带 Z）MySQL 无法稳定解析
  const countRows = await query<{ cnt: number }>(
    `SELECT COUNT(*) AS cnt FROM (
       SELECT b.user_id, b.best_score, MIN(r.createdAt) AS achieved_at
       FROM (
         SELECT user_id, MAX(score) AS best_score
         FROM recording
         WHERE segment_id = ? AND phase = ? AND score IS NOT NULL AND deleted_at IS NULL
         GROUP BY user_id
       ) b
       JOIN recording r ON r.user_id = b.user_id AND r.segment_id = ? AND r.phase = ?
         AND r.score = b.best_score AND r.deleted_at IS NULL
       JOIN user u ON u.id = b.user_id AND u.deleted_at IS NULL AND u.status = 1
       GROUP BY b.user_id, b.best_score
       HAVING b.best_score > ? OR (b.best_score = ? AND achieved_at < ?)
     ) t`,
    [segId, phase, segId, phase, myBest, myBest, mine.achievedAt],
  )

  return {
    list,
    me: {
      rank: Number(countRows[0]?.cnt ?? 0) + 1,
      bestScore: myBest,
      achievedAt: toIso(mine.achievedAt),
    },
  }
}

/**
 * Segment 配音（phase3）/ 跟读（phase4）排行榜
 * 请求：GET /api/segment/[segId]/leaderboard（登录必需，auth 中间件已拦截游客）
 */
export default defineEventHandler(async (event): Promise<ResPayload<SegmentLeaderboard | null>> => {
  const user = event.context.user
  const userId: number = user.id
  const segId = Number(getRouterParam(event, 'segId'))

  if (!segId || isNaN(segId)) {
    return validateError('无效的片段ID')
  }

  // 可见性护栏：与 units/[unitId]/progress 同口径——管理员全可见，
  // 普通用户仅公开材料或自己上传的材料（私有材料排行榜对外 404 防探测）
  const segments = await query<{
    id: number
    title: string
    unit_id: number
    is_public: number
    uploader_id: number | null
  }>(
    `SELECT s.id, s.title, s.unit_id, s.is_public, m.uploader_id
     FROM segment s
     LEFT JOIN media m ON s.media_id = m.id
     WHERE s.id = ? AND s.deleted_at IS NULL`,
    [segId],
  )
  const segment = segments[0]
  const isAdmin = user.role === ROLE_ADMIN
  if (!segment || (!isAdmin && segment.is_public !== 1 && segment.uploader_id !== userId)) {
    return validateError('片段不存在', 404)
  }

  const [phase3, phase4] = await Promise.all([
    buildBoard(segId, 3, userId),
    buildBoard(segId, 4, userId),
  ])

  const result: SegmentLeaderboard = {
    segment: { id: segment.id, title: segment.title, unitId: segment.unit_id },
    phase3,
    phase4,
  }

  return validateSuccess(result, '获取排行榜成功')
})
