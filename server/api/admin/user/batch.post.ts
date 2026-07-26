import { readBody } from 'h3'
import { query } from '#server/utils/db'
import { adminUserBatchSchema, validateSuccess, validateError } from '#server/utils/validate'
import { logAdminOperation } from '#server/utils/adminLog'
import { isAdminOrAbove } from '#shared/utils/role'
import { ensurePermission } from '#server/utils/permission'
import { PERMISSIONS } from '#shared/utils/permission'
import type { BatchResult, BatchSkippedItem } from '#shared/types/adminBatch'
import type { ResultSetHeader } from 'mysql2'

/**
 * 管理员批量操作用户（部分成功语义，HTTP 恒 200，结果见 BatchResult）
 * POST /api/admin/user/batch
 *
 * - ban / unban：批量封禁/解封（status 0/1）
 * - delete：批量销号（软删除）
 * 护栏与单条端点一致，逐条过滤进 skipped：自己 / 管理员及以上 / 已注销 / 状态已一致。
 * 封禁后由 auth 中间件在每次请求时查 DB 拦截，旧 token 即时失效。
 */
export default defineEventHandler(async (event) => {
  // 纵深防御：中间件已对 /api/admin/* 做管理员门禁，此处再校验一次
  const err = ensurePermission(event, PERMISSIONS.MANAGE_USERS)
  if (err) return err
  const user = event.context.user

  const body = await readBody(event)
  const parsed = adminUserBatchSchema.safeParse(body)
  if (!parsed.success) {
    return validateError(parsed.error?.issues?.[0]?.message ?? '参数校验失败', 400)
  }
  const { action, ids } = parsed.data

  // 一次预查目标用户（未注销），JS 层逐条过滤护栏
  const placeholders = ids.map(() => '?').join(', ')
  const rows = await query<{ id: number; role: number; status: number; account: string }>(
    `SELECT id, role, status, account FROM user WHERE id IN (${placeholders}) AND deleted_at IS NULL`,
    ids,
  )
  const rowMap = new Map(rows.map((r) => [r.id, r]))

  const skipped: BatchSkippedItem[] = []
  const passedIds: number[] = []
  const passedAccounts: string[] = []
  for (const id of ids) {
    const target = rowMap.get(id)
    if (id === user.id) {
      skipped.push({ id, reason: '不能对自己执行此操作' })
    } else if (!target) {
      skipped.push({ id, reason: '用户不存在或已注销' })
    } else if (isAdminOrAbove(target.role)) {
      skipped.push({ id, reason: '不能对管理员或超级管理员执行此操作' })
    } else if (action === 'ban' && target.status === 0) {
      skipped.push({ id, reason: '该用户已处于封禁状态' })
    } else if (action === 'unban' && target.status === 1) {
      skipped.push({ id, reason: '该用户已处于正常状态' })
    } else {
      passedIds.push(id)
      passedAccounts.push(target.account)
    }
  }

  let succeeded = 0
  if (passedIds.length > 0) {
    const passedPlaceholders = passedIds.map(() => '?').join(', ')
    let result: ResultSetHeader
    if (action === 'delete') {
      result = (await query<ResultSetHeader>(
        `UPDATE user SET deleted_at = NOW() WHERE id IN (${passedPlaceholders}) AND deleted_at IS NULL`,
        passedIds,
      )) as unknown as ResultSetHeader
    } else {
      const status = action === 'ban' ? 0 : 1
      result = (await query<ResultSetHeader>(
        `UPDATE user SET status = ? WHERE id IN (${passedPlaceholders}) AND deleted_at IS NULL`,
        [status, ...passedIds],
      )) as unknown as ResultSetHeader
    }
    succeeded = result.affectedRows ?? 0
  }

  const logAction =
    action === 'ban' ? 'user.batchBan' : action === 'unban' ? 'user.batchUnban' : 'user.batchDelete'
  await logAdminOperation(user.id, logAction, 'user', 0, {
    ids,
    accounts: passedAccounts,
    succeeded,
    skipped,
  })

  const data: BatchResult = { succeeded, skipped }
  return validateSuccess(data, `成功 ${succeeded} 条，跳过 ${skipped.length} 条`)
})
