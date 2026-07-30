/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mergeGuestData } from '../guestMerge'

const { mockConnExecute } = vi.hoisted(() => ({ mockConnExecute: vi.fn() }))

// withTransaction 以假连接执行回调
vi.mock('#server/utils/db', () => ({
  withTransaction: (fn: (conn: any) => Promise<unknown>) => fn({ execute: mockConnExecute }),
}))

beforeEach(() => {
  vi.clearAllMocks()
})

describe('mergeGuestData 合并', () => {
  it('无游客行 → 幂等 return，不置 latch/不搬数据', async () => {
    mockConnExecute.mockResolvedValueOnce([[]]) // SELECT 游客行无
    await mergeGuestData('gk', 100)
    expect(mockConnExecute).toHaveBeenCalledTimes(1)
  })

  it('latch affectedRows=0（并发抢占/已合并）→ 短路，不搬数据', async () => {
    mockConnExecute
      .mockResolvedValueOnce([[{ id: 50 }]]) // SELECT 定位游客行
      .mockResolvedValueOnce([{ affectedRows: 0 }]) // latch UPDATE 未命中
    await mergeGuestData('gk', 100)
    expect(mockConnExecute).toHaveBeenCalledTimes(2)
  })

  it('正常合并：latch 成功 → 合并 log + 累加 stats（含 latch 共 4 次）', async () => {
    mockConnExecute
      .mockResolvedValueOnce([[{ id: 50 }]]) // SELECT
      .mockResolvedValueOnce([{ affectedRows: 1 }]) // latch UPDATE 成功
      .mockResolvedValueOnce([{ affectedRows: 3 }]) // 合并 checkin_log
      .mockResolvedValueOnce([{ affectedRows: 1 }]) // 累加 stats
    await mergeGuestData('gk', 100)
    expect(mockConnExecute).toHaveBeenCalledTimes(4)
    // latch：置 merged_into_user_id + 软删，带幂等条件
    const latchSql = String(mockConnExecute.mock.calls[1][0])
    expect(latchSql).toContain('SET merged_into_user_id = ?, deleted_at = NOW()')
    expect(latchSql).toContain('merged_into_user_id IS NULL')
    // log 合并：同日累加时长
    const logSql = String(mockConnExecute.mock.calls[2][0])
    expect(logSql).toContain('study_seconds = study_seconds + VALUES(study_seconds)')
    // stats 累加
    expect(String(mockConnExecute.mock.calls[3][0])).toContain('total_study_seconds = t.total_study_seconds + g.total_study_seconds')
  })

  it('自合并（游客行 id === 目标 id）→ 防御性 return', async () => {
    mockConnExecute.mockResolvedValueOnce([[{ id: 100 }]]) // SELECT 命中但 id 等于 target
    await mergeGuestData('gk', 100)
    expect(mockConnExecute).toHaveBeenCalledTimes(1)
  })

  it('异常向上抛（由调用方 catch，合并失败不阻断登录）', async () => {
    mockConnExecute.mockRejectedValueOnce(new Error('db down'))
    await expect(mergeGuestData('gk', 100)).rejects.toThrow('db down')
  })
})
