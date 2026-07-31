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

  it('正常合并：latch 成功 → 合并 log + stats + progress + 收藏 + 录音（含 latch 共 8 次）', async () => {
    mockConnExecute
      .mockResolvedValueOnce([[{ id: 50 }]]) // SELECT
      .mockResolvedValueOnce([{ affectedRows: 1 }]) // latch UPDATE 成功
      .mockResolvedValueOnce([{ affectedRows: 3 }]) // 合并 checkin_log
      .mockResolvedValueOnce([{ affectedRows: 1 }]) // 累加 stats
      .mockResolvedValueOnce([{ affectedRows: 2 }]) // 合并 progress
      .mockResolvedValueOnce([{ affectedRows: 1 }]) // 合并 fav_segment
      .mockResolvedValueOnce([{ affectedRows: 1 }]) // 合并 fav_word
      .mockResolvedValueOnce([{ affectedRows: 5 }]) // 迁移 recording
    await mergeGuestData('gk', 100)
    expect(mockConnExecute).toHaveBeenCalledTimes(8)
    // latch：置 merged_into_user_id + 软删，带幂等条件
    const latchSql = String(mockConnExecute.mock.calls[1][0])
    expect(latchSql).toContain('SET merged_into_user_id = ?, deleted_at = NOW()')
    expect(latchSql).toContain('merged_into_user_id IS NULL')
    // log 合并：同日累加时长
    const logSql = String(mockConnExecute.mock.calls[2][0])
    expect(logSql).toContain('study_seconds = study_seconds + VALUES(study_seconds)')
    // stats 累加
    expect(String(mockConnExecute.mock.calls[3][0])).toContain('total_study_seconds = t.total_study_seconds + g.total_study_seconds')
    // progress 合并：取优策略
    const progSql = String(mockConnExecute.mock.calls[4][0])
    expect(progSql).toContain('INSERT INTO user_progress')
    expect(progSql).toContain('ON DUPLICATE KEY UPDATE')
    expect(progSql).toContain('phase3_score')
    // 收藏合并：INSERT IGNORE
    const favSegSql = String(mockConnExecute.mock.calls[5][0])
    expect(favSegSql).toContain('INSERT IGNORE INTO user_fav_segment')
    const favWordSql = String(mockConnExecute.mock.calls[6][0])
    expect(favWordSql).toContain('INSERT IGNORE INTO user_fav_word')
    // 录音迁移：UPDATE user_id
    const recSql = String(mockConnExecute.mock.calls[7][0])
    expect(recSql).toContain('UPDATE recording SET user_id = ?')
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

  it('零数据合并：游客无进度/收藏/录音 → SQL 仍执行但 affectedRows 全为 0', async () => {
    mockConnExecute
      .mockResolvedValueOnce([[{ id: 50 }]]) // SELECT 定位游客行
      .mockResolvedValueOnce([{ affectedRows: 1 }]) // latch 成功
      .mockResolvedValueOnce([{ affectedRows: 0 }]) // checkin_log 无数据可合并
      .mockResolvedValueOnce([{ affectedRows: 0 }]) // stats 无数据可累加
      .mockResolvedValueOnce([{ affectedRows: 0 }]) // progress 无数据
      .mockResolvedValueOnce([{ affectedRows: 0 }]) // fav_segment 无数据
      .mockResolvedValueOnce([{ affectedRows: 0 }]) // fav_word 无数据
      .mockResolvedValueOnce([{ affectedRows: 0 }]) // recording 无数据
    await mergeGuestData('gk', 200)
    // 即使无数据，8 次 SQL 调用仍然全部执行（不短路）
    expect(mockConnExecute).toHaveBeenCalledTimes(8)
  })

  it('合并参数绑定：progress/fav/recording SQL 使用正确的 targetUserId 和 guestId', async () => {
    mockConnExecute
      .mockResolvedValueOnce([[{ id: 50 }]]) // SELECT
      .mockResolvedValueOnce([{ affectedRows: 1 }]) // latch
      .mockResolvedValueOnce([{ affectedRows: 1 }]) // log
      .mockResolvedValueOnce([{ affectedRows: 1 }]) // stats
      .mockResolvedValueOnce([{ affectedRows: 1 }]) // progress
      .mockResolvedValueOnce([{ affectedRows: 1 }]) // fav_segment
      .mockResolvedValueOnce([{ affectedRows: 1 }]) // fav_word
      .mockResolvedValueOnce([{ affectedRows: 3 }]) // recording
    await mergeGuestData('test-guest-key', 999)

    // progress: 参数 [targetUserId, guestId]
    expect(mockConnExecute.mock.calls[4][1]).toEqual([999, 50])
    // fav_segment: 参数 [targetUserId, guestId]
    expect(mockConnExecute.mock.calls[5][1]).toEqual([999, 50])
    // fav_word: 参数 [targetUserId, guestId]
    expect(mockConnExecute.mock.calls[6][1]).toEqual([999, 50])
    // recording: 参数 [targetUserId, guestId]
    expect(mockConnExecute.mock.calls[7][1]).toEqual([999, 50])
  })

  it('合并完成后输出统计日志', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    mockConnExecute
      .mockResolvedValueOnce([[{ id: 50 }]]) // SELECT
      .mockResolvedValueOnce([{ affectedRows: 1 }]) // latch
      .mockResolvedValueOnce([{ affectedRows: 3 }]) // log
      .mockResolvedValueOnce([{ affectedRows: 1 }]) // stats
      .mockResolvedValueOnce([{ affectedRows: 2 }]) // progress
      .mockResolvedValueOnce([{ affectedRows: 1 }]) // fav_segment
      .mockResolvedValueOnce([{ affectedRows: 4 }]) // fav_word
      .mockResolvedValueOnce([{ affectedRows: 5 }]) // recording
    await mergeGuestData('gk', 100)
    expect(logSpy).toHaveBeenCalledTimes(1)
    const logMsg = logSpy.mock.calls[0][0] as string
    expect(logMsg).toContain('[guestMerge]')
    expect(logMsg).toContain('progress=2')
    expect(logMsg).toContain('fav_segment=1')
    expect(logMsg).toContain('fav_word=4')
    expect(logMsg).toContain('recording=5')
    logSpy.mockRestore()
  })
})
