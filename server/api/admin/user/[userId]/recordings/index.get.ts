import { query } from '#server/utils/db'
import { adminUserRecordingListSchema } from '#shared/schemas/adminUser'
import { validateSuccess, validateError } from '#server/utils/validate'
import { ensurePermission } from '#server/services/permission'
import { PERMISSIONS } from '#shared/utils/permission'
import type {
  AdminUserRecordingListItem,
  AdminUserRecordingListResult,
  AdminUserUnitOption,
} from '#shared/types/adminUser'

/**
 * 管理员查看某用户的录音记录列表（分页 + 筛选）
 * GET /api/admin/user/:userId/recordings
 *
 * 仅返回元数据（阶段/得分/时长/评测状态/片段/单元/时间），绝不含音频 object_key、
 * 识别文本或逐词评分——敏感字段只经审核门禁 POST（REVIEW 权限 + 留痕）暴露。
 */
export default defineEventHandler(async (event) => {
  // 纵深防御（与用户详情页同门禁）
  const err = ensurePermission(event, PERMISSIONS.MANAGE_USERS)
  if (err) return err

  const userId = Number(getRouterParam(event, 'userId'))
  if (!userId || isNaN(userId)) return validateError('无效的用户ID')

  const parsed = adminUserRecordingListSchema.safeParse(getQuery(event))
  if (!parsed.success) {
    return validateError(parsed.error?.issues?.[0]?.message ?? '参数校验失败', 400)
  }
  const { page, pageSize, phase, unitId, keyword, scoreBand, startDate, endDate } = parsed.data
  const offset = (page - 1) * pageSize

  // 动态 WHERE：恒以 user_id + 未删除 起始
  const where: string[] = ['r.user_id = ?', 'r.deleted_at IS NULL']
  const listParams: (number | string)[] = [userId]
  const countParams: (number | string)[] = [userId]

  if (phase) {
    where.push('r.phase = ?')
    listParams.push(phase)
    countParams.push(phase)
  }
  if (unitId) {
    where.push('s.unit_id = ?')
    listParams.push(unitId)
    countParams.push(unitId)
  }
  if (keyword) {
    where.push('s.title LIKE ?')
    const like = `%${keyword}%`
    listParams.push(like)
    countParams.push(like)
  }
  // 分数档：>= / < 比较天然排除 NULL，故 NULL 分数仅在 all 出现
  if (scoreBand === 'high') {
    where.push('r.score >= 80')
  } else if (scoreBand === 'mid') {
    where.push('r.score >= 60 AND r.score < 80')
  } else if (scoreBand === 'low') {
    where.push('r.score < 60')
  }
  if (startDate) {
    where.push('r.createdAt >= ?')
    listParams.push(startDate + ' 00:00:00')
    countParams.push(startDate + ' 00:00:00')
  }
  if (endDate) {
    where.push('r.createdAt < ?')
    const nextDay = new Date(endDate)
    nextDay.setDate(nextDay.getDate() + 1)
    const nextDayStr = nextDay.toISOString().slice(0, 10)
    listParams.push(nextDayStr + ' 00:00:00')
    countParams.push(nextDayStr + ' 00:00:00')
  }
  const whereSql = 'WHERE ' + where.join(' AND ')

  // 列表查询（JOIN segment/unit 取标题；不含音频 / 识别文本 / 逐词）
  const rows = await query<{
    id: number
    phase: number
    score: string | null
    duration: string | null
    analyze_status: string
    segmentTitle: string
    unitId: number
    unitTitle: string
    createdAt: string
  }>(
    `SELECT r.id, r.phase, r.score, r.duration, r.analyze_status,
            s.title AS segmentTitle, s.unit_id AS unitId, u.title AS unitTitle, r.createdAt
     FROM recording r
     JOIN segment s ON r.segment_id = s.id
     JOIN unit u ON s.unit_id = u.id
     ${whereSql}
     ORDER BY r.createdAt DESC, r.id DESC
     LIMIT ? OFFSET ?`,
    [...listParams, pageSize, offset],
  )

  // 独立 COUNT（同 WHERE，无需 unit join）
  const countRows = await query<{ total: number }>(
    `SELECT COUNT(*) AS total
     FROM recording r
     JOIN segment s ON r.segment_id = s.id
     ${whereSql}`,
    countParams,
  )
  const total = Number(countRows[0]?.total ?? 0)

  // 单元下拉：该用户实际有录音的单元
  const unitOptions = await query<AdminUserUnitOption>(
    `SELECT DISTINCT s.unit_id AS unitId, u.title AS unitTitle, u.sort_order AS sortOrder
     FROM recording r
     JOIN segment s ON r.segment_id = s.id
     JOIN unit u ON s.unit_id = u.id
     WHERE r.user_id = ? AND r.deleted_at IS NULL
     ORDER BY u.sort_order`,
    [userId],
  )

  const list: AdminUserRecordingListItem[] = rows.map((row) => ({
    id: row.id,
    phase: row.phase,
    score: row.score != null ? Number(row.score) : null,
    duration: row.duration != null ? Number(row.duration) : null,
    analyzeStatus: (row.analyze_status ?? 'pending') as 'pending' | 'failed' | 'success',
    segmentTitle: row.segmentTitle,
    unitId: row.unitId,
    unitTitle: row.unitTitle,
    createdAt: row.createdAt,
  }))

  const result: AdminUserRecordingListResult = { list, total, page, pageSize, unitOptions }
  return validateSuccess(result, '获取录音记录列表成功')
})
