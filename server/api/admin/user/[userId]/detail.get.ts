import { query } from '#server/utils/db'
import { validateSuccess, validateError } from '#server/utils/validate'
import { ensurePermission } from '#server/utils/permission'
import { PERMISSIONS } from '#shared/utils/permission'
import type {
  AdminUserDetail,
  AdminUserLearningStats,
  AdminUserUnitProgress,
  AdminUserRecordingItem,
} from '#shared/types/adminUser'

interface UserRow {
  id: number
  account: string
  nickname: string | null
  email: string | null
  role: number
  level: number
  status: number
  deletedAt: string | null
  createdAt: string
}

interface StatsRow {
  totalSegmentsCompleted: number
  totalRecordings: number
  avgScore: number | null
}

interface CheckinRow {
  totalStudySeconds: number
  totalCheckinDays: number
  currentStreak: number
}

interface ProgressRow {
  segmentId: number
  segmentTitle: string
  unitId: number
  unitTitle: string
  phase1Done: number
  phase2Done: number
  phase3Done: number
  phase4Done: number
  phase3Score: number | null
  phase4Score: number | null
}

interface RecordingRow {
  id: number
  phase: number
  score: number | null
  duration: number | null
  segmentTitle: string
  createdAt: string
}

/**
 * 管理员查看用户详情（学习统计 + Unit 进度 + 录音历史）
 * GET /api/admin/user/:userId/detail
 */
export default defineEventHandler(async (event) => {
  const err = ensurePermission(event, PERMISSIONS.MANAGE_USERS)
  if (err) return err

  const userId = Number(getRouterParam(event, 'userId'))
  if (!userId || isNaN(userId)) {
    return validateError('无效的用户ID')
  }

  // 1. 用户基本信息
  const userRows = await query<UserRow>(
    'SELECT id, account, nickname, email, role, level, status, deleted_at AS deletedAt, createdAt FROM user WHERE id = ?',
    [userId],
  )
  if (userRows.length === 0) {
    return validateError('用户不存在', 404)
  }
  const targetUser = userRows[0]!

  // 2. 学习统计（并行查询）
  const statsPromise = query<StatsRow>(
    `SELECT
       (SELECT COUNT(*) FROM user_progress WHERE user_id = ? AND phase2_done = 1 AND deleted_at IS NULL) AS totalSegmentsCompleted,
       (SELECT COUNT(*) FROM recording WHERE user_id = ? AND deleted_at IS NULL) AS totalRecordings,
       (SELECT ROUND(AVG(score), 1) FROM recording WHERE user_id = ? AND score IS NOT NULL AND deleted_at IS NULL) AS avgScore`,
    [userId, userId, userId],
  )

  const checkinPromise = query<CheckinRow>(
    'SELECT total_study_seconds AS totalStudySeconds, total_checkin_days AS totalCheckinDays, current_streak_days AS currentStreak FROM user_checkin_stats WHERE user_id = ?',
    [userId],
  )

  // 3. Unit 进度
  const progressPromise = query<ProgressRow>(
    `SELECT
       s.id AS segmentId, s.title AS segmentTitle,
       u.id AS unitId, u.title AS unitTitle,
       COALESCE(up.phase1_done, 0) AS phase1Done,
       COALESCE(up.phase2_done, 0) AS phase2Done,
       COALESCE(up.phase3_done, 0) AS phase3Done,
       COALESCE(up.phase4_done, 0) AS phase4Done,
       up.phase3_score AS phase3Score,
       up.phase4_score AS phase4Score
     FROM segment s
     JOIN unit u ON s.unit_id = u.id
     LEFT JOIN user_progress up ON up.segment_id = s.id AND up.user_id = ?
     WHERE s.deleted_at IS NULL
     ORDER BY u.sort_order, s.sort_order`,
    [userId],
  )

  // 4. 录音历史（仅元数据，不含音频 URL / 识别内容）
  const recordingsPromise = query<RecordingRow>(
    `SELECT r.id, r.phase, r.score, r.duration, s.title AS segmentTitle, r.createdAt
     FROM recording r
     JOIN segment s ON r.segment_id = s.id
     WHERE r.user_id = ? AND r.deleted_at IS NULL
     ORDER BY r.createdAt DESC
     LIMIT 20`,
    [userId],
  )

  const [statsRows, checkinRows, progressRows, recordingRows] = await Promise.all([
    statsPromise,
    checkinPromise,
    progressPromise,
    recordingsPromise,
  ])

  const stats: AdminUserLearningStats = {
    totalSegmentsCompleted: Number(statsRows[0]?.totalSegmentsCompleted ?? 0),
    totalRecordings: Number(statsRows[0]?.totalRecordings ?? 0),
    avgScore: statsRows[0]?.avgScore != null ? Number(statsRows[0]!.avgScore) : null,
    totalStudySeconds: Number(checkinRows[0]?.totalStudySeconds ?? 0),
    totalCheckinDays: Number(checkinRows[0]?.totalCheckinDays ?? 0),
    currentStreak: Number(checkinRows[0]?.currentStreak ?? 0),
  }

  // 按 Unit 分组
  const unitMap = new Map<number, AdminUserUnitProgress>()
  for (const row of progressRows) {
    if (!unitMap.has(row.unitId)) {
      unitMap.set(row.unitId, {
        unitId: row.unitId,
        unitTitle: row.unitTitle,
        segments: [],
      })
    }
    unitMap.get(row.unitId)!.segments.push({
      segmentId: row.segmentId,
      segmentTitle: row.segmentTitle,
      phase1Done: row.phase1Done === 1,
      phase2Done: row.phase2Done === 1,
      phase3Done: row.phase3Done === 1,
      phase4Done: row.phase4Done === 1,
      phase3Score: row.phase3Score,
      phase4Score: row.phase4Score,
    })
  }

  const recordings: AdminUserRecordingItem[] = recordingRows.map((r) => ({
    id: r.id,
    phase: r.phase,
    score: r.score,
    duration: r.duration,
    segmentTitle: r.segmentTitle,
    createdAt: r.createdAt,
  }))

  const result: AdminUserDetail = {
    user: targetUser,
    stats,
    unitProgress: Array.from(unitMap.values()),
    recentRecordings: recordings,
  }

  return validateSuccess(result, '获取用户详情成功')
})
