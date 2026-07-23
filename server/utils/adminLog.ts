// server/utils/adminLog.ts
// 管理员操作日志：记录敏感操作（封禁/销号/改资料/材料编辑删除），便于追溯。
import { query } from '#server/utils/db'

/**
 * 写入一条管理员操作日志。
 *
 * 写日志失败【静默吞错】——日志是旁路能力，绝不阻塞业务流程，仅记 logger.error。
 *
 * @param adminId    操作者（管理员）用户 ID
 * @param action     操作类型，如 'user.ban' | 'user.unban' | 'user.delete' | 'user.update' | 'segment.update' | 'segment.delete'
 * @param targetType 操作对象类型，'user' | 'segment'
 * @param targetId   操作对象 ID
 * @param detail     操作详情（变更前后关键字段快照），将以 JSON 存入 detail 列
 */
export async function logAdminOperation(
  adminId: number,
  action: string,
  targetType: string,
  targetId: number,
  detail?: Record<string, unknown>,
): Promise<void> {
  try {
    await query(
      `INSERT INTO admin_operation_log (admin_id, action, target_type, target_id, detail)
       VALUES (?, ?, ?, ?, ?)`,
      [adminId, action, targetType, targetId, detail ? JSON.stringify(detail) : null],
    )
  } catch (err) {
    // 日志写入失败不影响业务
    logger.error('[admin log] 操作日志写入失败:', err)
  }
}
