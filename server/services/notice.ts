// server/services/notice.ts
// 系统公告业务层：活跃口径统一、用户端已读回执、管理端增删改与状态机。
// 依赖方向：本模块 → #server/utils/db（纯工具）+ #server/services/adminLog（操作留痕）。
//
// 【Redis 扩展点】
// - 未读数缓存：getUnreadCount 当前每次实时 NOT EXISTS 计数，后续可用 key notice:unread:{userId}
//   缓存结果（发布/已读/撤回时失效），在 getUnreadCount 内替换实现即可，调用方无感。
// - 发布事件：createNotice / updateNotice 在「发布时机」（status 落为 published 且 publish_at<=now）
//   可向 pub/sub 通道发消息，驱动在线用户红点即时刷新，此处为事件发布的接入点。
import type { ResultSetHeader } from 'mysql2'
import { query } from '#server/utils/db'
import { logAdminOperation } from '#server/services/adminLog'
import type { NoticeRow } from '#server/types/db'
import type {
  NoticeListItem,
  NoticeListResult,
  NoticeDetail,
  NoticeStatus,
  NoticeCreatePayload,
  NoticeUpdatePayload,
  AdminNoticeListItem,
  AdminNoticeListResult,
} from '#shared/types/notice'

/**
 * 活跃公告统一口径（notice 表别名固定为 n）：
 * 已发布 + 未软删 + 已到发布时刻 + 未过期。三态中无 scheduled，
 * 「定时发布」靠 publish_at <= NOW() 到点自动纳入活跃集。
 */
const ACTIVE_NOTICE_CLAUSE =
  "n.status = 'published' AND n.deleted_at IS NULL AND n.publish_at <= NOW() AND (n.expire_at IS NULL OR n.expire_at > NOW())"

/** 用户端活跃公告查询行（SQL 已 AS 为 camelCase，isPinned/isRead 为 0/1） */
interface ActiveNoticeQueryRow {
  id: number
  title: string
  content: string
  status: NoticeStatus
  publishAt: string
  expireAt: string | null
  isPinned: number
  createdAt: string
  isRead: number
}

/** 管理端公告查询行（含 readCount / createdByName） */
interface AdminNoticeQueryRow {
  id: number
  title: string
  content: string
  status: NoticeStatus
  publishAt: string
  expireAt: string | null
  isPinned: number
  createdAt: string
  createdByName: string | null
  readCount: number | string
}

/**
 * datetime 归一化：el-date-picker 常用 'YYYY-MM-DD HH:mm:ss'（MySQL 直接可用）；
 * 兼容 ISO 'YYYY-MM-DDTHH:mm:ss(.sssZ)'——纯字符串处理（不经 Date，避免时区偏移），
 * 把 'T' 换成空格并截到秒精度。无法识别的原样返回，交由 DB 兜底报错。
 */
function normalizeDatetime(input: string): string {
  const s = input.trim().replace('T', ' ')
  const m = s.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2})(:\d{2})?/)
  if (!m) return s
  return m[2] ? `${m[1]}${m[2]}` : `${m[1]}:00`
}

/** 从 ResultSetHeader 取 affectedRows（query 泛型封装下需二次断言） */
function affectedRowsOf(result: unknown): number {
  return (result as ResultSetHeader).affectedRows ?? 0
}

/** 从 ResultSetHeader 取 insertId */
function insertIdOf(result: unknown): number {
  return (result as ResultSetHeader).insertId ?? 0
}

/**
 * 用户端活跃公告分页列表（置顶优先 + createdAt 倒序），附带当前用户 isRead。
 */
export async function getActiveNotices(
  userId: number,
  page: number,
  pageSize: number,
): Promise<NoticeListResult> {
  const offset = (page - 1) * pageSize
  const rows = await query<ActiveNoticeQueryRow>(
    `SELECT n.id, n.title, n.content, n.status,
            n.publish_at AS publishAt, n.expire_at AS expireAt,
            n.is_pinned AS isPinned, n.createdAt,
            (nr.id IS NOT NULL) AS isRead
     FROM notice n
     LEFT JOIN notice_read nr ON nr.notice_id = n.id AND nr.user_id = ?
     WHERE ${ACTIVE_NOTICE_CLAUSE}
     ORDER BY n.is_pinned DESC, n.createdAt DESC
     LIMIT ? OFFSET ?`,
    [userId, pageSize, offset],
  )

  const countRows = await query<{ total: number }>(
    `SELECT COUNT(*) AS total FROM notice n WHERE ${ACTIVE_NOTICE_CLAUSE}`,
  )
  const total = Number(countRows[0]?.total ?? 0)

  const list: NoticeListItem[] = rows.map((r) => ({
    id: r.id,
    title: r.title,
    content: r.content,
    status: r.status,
    publishAt: r.publishAt,
    expireAt: r.expireAt,
    isPinned: Boolean(r.isPinned),
    createdAt: r.createdAt,
    isRead: Boolean(r.isRead),
  }))

  return { list, total, page, pageSize }
}

/**
 * 未读活跃公告数量（NOT EXISTS 计数）。
 * 【Redis 扩展点】此处可替换为 notice:unread:{userId} 缓存读取。
 */
export async function getUnreadCount(userId: number): Promise<number> {
  const rows = await query<{ cnt: number }>(
    `SELECT COUNT(*) AS cnt
     FROM notice n
     WHERE ${ACTIVE_NOTICE_CLAUSE}
       AND NOT EXISTS (
         SELECT 1 FROM notice_read nr WHERE nr.notice_id = n.id AND nr.user_id = ?
       )`,
    [userId],
  )
  return Number(rows[0]?.cnt ?? 0)
}

/**
 * 标记单条公告已读（INSERT IGNORE 幂等：重复标记不报错、不产生多行）。
 */
export async function markAsRead(userId: number, noticeId: number): Promise<void> {
  await query('INSERT IGNORE INTO notice_read (user_id, notice_id) VALUES (?, ?)', [
    userId,
    noticeId,
  ])
}

/**
 * 一键已读：把全部活跃公告写入回执（INSERT IGNORE ... SELECT，已读的自动跳过）。
 * 返回本次新增回执行数。
 */
export async function markAllAsRead(userId: number): Promise<number> {
  const result = await query(
    `INSERT IGNORE INTO notice_read (user_id, notice_id)
     SELECT ?, n.id FROM notice n WHERE ${ACTIVE_NOTICE_CLAUSE}`,
    [userId],
  )
  return affectedRowsOf(result)
}

/**
 * 用户端公告详情：仅活跃公告可见（非活跃返回 null，由端点转 404）；
 * 命中后 fire-and-forget 标记已读（不阻塞响应）。
 */
export async function getNoticeDetailForUser(
  userId: number,
  noticeId: number,
): Promise<NoticeDetail | null> {
  const rows = await query<ActiveNoticeQueryRow>(
    `SELECT n.id, n.title, n.content, n.status,
            n.publish_at AS publishAt, n.expire_at AS expireAt,
            n.is_pinned AS isPinned, n.createdAt
     FROM notice n
     WHERE n.id = ? AND ${ACTIVE_NOTICE_CLAUSE}`,
    [noticeId],
  )
  const row = rows[0]
  if (!row) return null

  // fire-and-forget：标已读失败不影响详情返回，catch 防止未处理拒绝
  void markAsRead(userId, noticeId).catch(() => {})

  return {
    id: row.id,
    title: row.title,
    content: row.content,
    status: row.status,
    publishAt: row.publishAt,
    expireAt: row.expireAt,
    isPinned: Boolean(row.isPinned),
    createdAt: row.createdAt,
  }
}

/**
 * 管理端公告列表：含全部状态（status='all' 不过滤），附创建者昵称与阅读数。
 * 软删除公告不纳入。
 */
export async function getNoticesForAdmin(
  keyword: string | undefined,
  status: 'all' | NoticeStatus,
  page: number,
  pageSize: number,
): Promise<AdminNoticeListResult> {
  const offset = (page - 1) * pageSize
  const where: string[] = ['n.deleted_at IS NULL']
  const params: (string | number)[] = []
  if (status !== 'all') {
    where.push('n.status = ?')
    params.push(status)
  }
  if (keyword) {
    where.push('n.title LIKE ?')
    params.push(`%${keyword}%`)
  }
  const whereSql = where.join(' AND ')

  const rows = await query<AdminNoticeQueryRow>(
    `SELECT n.id, n.title, n.content, n.status,
            n.publish_at AS publishAt, n.expire_at AS expireAt,
            n.is_pinned AS isPinned, n.createdAt,
            u.nickname AS createdByName,
            COUNT(nr.id) AS readCount
     FROM notice n
     LEFT JOIN user u ON u.id = n.created_by
     LEFT JOIN notice_read nr ON nr.notice_id = n.id
     WHERE ${whereSql}
     GROUP BY n.id
     ORDER BY n.is_pinned DESC, n.createdAt DESC
     LIMIT ? OFFSET ?`,
    [...params, pageSize, offset],
  )

  const countRows = await query<{ total: number }>(
    `SELECT COUNT(*) AS total FROM notice n WHERE ${whereSql}`,
    params,
  )
  const total = Number(countRows[0]?.total ?? 0)

  const list: AdminNoticeListItem[] = rows.map((r) => ({
    id: r.id,
    title: r.title,
    content: r.content,
    status: r.status,
    publishAt: r.publishAt,
    expireAt: r.expireAt,
    isPinned: Boolean(r.isPinned),
    createdAt: r.createdAt,
    createdByName: r.createdByName,
    readCount: Number(r.readCount ?? 0),
  }))

  return { list, total, page, pageSize }
}

/**
 * 创建公告：status 仅允许 draft/published；发布态未传 publishAt 时取 NOW()。
 * 返回新公告 id。
 */
export async function createNotice(adminId: number, payload: NoticeCreatePayload): Promise<number> {
  const status: NoticeStatus = payload.status ?? 'draft'
  const isPinned = payload.isPinned ? 1 : 0
  const expireAt = payload.expireAt ? normalizeDatetime(payload.expireAt) : null

  // publish_at 为 NOT NULL：传了用值，未传用 NOW()（发布/草稿均落当前时间）
  const hasPublishAt = !!payload.publishAt
  const publishAtSql = hasPublishAt ? '?' : 'NOW()'
  const params: (string | number | null)[] = [payload.title, payload.content, status]
  if (hasPublishAt) params.push(normalizeDatetime(payload.publishAt as string))
  params.push(expireAt, isPinned, adminId)

  const result = await query(
    `INSERT INTO notice (title, content, status, publish_at, expire_at, is_pinned, created_by)
     VALUES (?, ?, ?, ${publishAtSql}, ?, ?, ?)`,
    params,
  )
  const id = insertIdOf(result)

  await logAdminOperation(adminId, 'notice.create', 'notice', id, {
    title: payload.title,
    status,
  })
  return id
}

/**
 * 更新公告，含状态转移校验：
 * - 草稿(draft)：全字段可改（含转 published/revoked）。
 * - 已发布(published)：仅允许改 expire_at / is_pinned，或将 status 转为 revoked；
 *   改 title/content/publish_at 或转其它状态一律拒绝。
 * - 已撤回(revoked)：不可再编辑。
 * 返回 null 表示成功；返回 { code, message } 表示业务错误（由端点转 validateError）。
 */
export async function updateNotice(
  adminId: number,
  noticeId: number,
  payload: NoticeUpdatePayload,
): Promise<{ code: number; message: string } | null> {
  const rows = await query<Pick<NoticeRow, 'id' | 'status' | 'deleted_at'>>(
    'SELECT id, status, deleted_at FROM notice WHERE id = ?',
    [noticeId],
  )
  const current = rows[0]
  if (!current || current.deleted_at) {
    return { code: 404, message: '公告不存在' }
  }

  const curStatus = current.status as NoticeStatus
  if (curStatus === 'revoked') {
    return { code: 400, message: '已撤回的公告不可再编辑' }
  }
  if (curStatus === 'published') {
    const touchesLocked =
      payload.title !== undefined ||
      payload.content !== undefined ||
      payload.publishAt !== undefined
    if (touchesLocked) {
      return { code: 400, message: '已发布公告仅允许修改过期时间、置顶状态或撤回' }
    }
    if (payload.status !== undefined && payload.status !== 'revoked') {
      return { code: 400, message: '已发布公告仅可转为已撤回' }
    }
  }

  // 动态 SET 拼接（仅落入传入字段）
  const sets: string[] = []
  const params: (string | number | null)[] = []
  if (payload.title !== undefined) {
    sets.push('title = ?')
    params.push(payload.title)
  }
  if (payload.content !== undefined) {
    sets.push('content = ?')
    params.push(payload.content)
  }
  if (payload.publishAt !== undefined) {
    sets.push('publish_at = ?')
    params.push(payload.publishAt ? normalizeDatetime(payload.publishAt) : null)
  }
  if (payload.expireAt !== undefined) {
    sets.push('expire_at = ?')
    params.push(payload.expireAt ? normalizeDatetime(payload.expireAt) : null)
  }
  if (payload.isPinned !== undefined) {
    sets.push('is_pinned = ?')
    params.push(payload.isPinned ? 1 : 0)
  }
  if (payload.status !== undefined) {
    sets.push('status = ?')
    params.push(payload.status)
  }

  if (sets.length === 0) {
    return { code: 400, message: '没有需要修改的字段' }
  }

  await query(`UPDATE notice SET ${sets.join(', ')} WHERE id = ?`, [...params, noticeId])

  // 转撤回记为 notice.revoke，其余记为 notice.update
  const action = payload.status === 'revoked' ? 'notice.revoke' : 'notice.update'
  await logAdminOperation(adminId, action, 'notice', noticeId, {
    fields: Object.keys(payload),
    status: payload.status,
  })
  return null
}

/**
 * 软删除公告（置 deleted_at）。返回 null 成功；{ code, message } 业务错误。
 */
export async function deleteNotice(
  adminId: number,
  noticeId: number,
): Promise<{ code: number; message: string } | null> {
  const result = await query(
    'UPDATE notice SET deleted_at = NOW() WHERE id = ? AND deleted_at IS NULL',
    [noticeId],
  )
  if (affectedRowsOf(result) === 0) {
    return { code: 404, message: '公告不存在或已删除' }
  }
  await logAdminOperation(adminId, 'notice.delete', 'notice', noticeId)
  return null
}
