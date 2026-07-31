/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { accumulateStudyTime } from '../studyTime'

// 隔离 checkinHelper：formatDate 固定、getStats 返回占位（聚焦累计逻辑）
vi.mock('../checkinHelper', () => ({
  formatDate: () => '2026-07-31',
  getStats: vi.fn().mockResolvedValue({
    totalCheckinDays: 0,
    lastCheckinTime: null,
    currentStreakDays: 0,
    maxStreakDays: 0,
    totalStudySeconds: 0,
  }),
}))

/** 造一条今日 log 行，updatedAt 为 agoSeconds 秒前 */
function logRow(studySeconds: number, agoSeconds: number) {
  return {
    id: 1,
    user_id: 10,
    checkin_date: '2026-07-31',
    checked_in: 0,
    study_seconds: studySeconds,
    segments_completed: 0,
    updatedAt: new Date(Date.now() - agoSeconds * 1000),
  }
}

function makeConn(selectResult: any) {
  const execute = vi.fn()
  execute.mockResolvedValueOnce([selectResult]) // 首次 SELECT log
  execute.mockResolvedValue([{ affectedRows: 1 }]) // 后续 UPDATE/INSERT
  return { execute } as any
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('accumulateStudyTime 防作弊回归', () => {
  it('无 log → INSERT IGNORE 建基准，不累计', async () => {
    const conn = makeConn([]) // SELECT 无行
    await accumulateStudyTime(conn, 10, 30)
    expect(String(conn.execute.mock.calls[1][0])).toContain('INSERT IGNORE INTO user_checkin_log')
    // 只有 SELECT + INSERT IGNORE，无 UPDATE
    expect(conn.execute).toHaveBeenCalledTimes(2)
  })

  it('间隔 < 10s → 忽略（不 UPDATE）', async () => {
    const conn = makeConn([logRow(0, 3)]) // 3s 前
    await accumulateStudyTime(conn, 10, 30)
    expect(conn.execute).toHaveBeenCalledTimes(1) // 仅 SELECT
  })

  it('上报远超间隔（刷时长）→ 不累计', async () => {
    const conn = makeConn([logRow(0, 30)]) // 间隔 30s
    await accumulateStudyTime(conn, 10, 600) // 上报 600s，间隔仅 30s（<600-10）
    expect(conn.execute).toHaveBeenCalledTimes(1)
  })
})

describe('accumulateStudyTime 累计与封顶', () => {
  it('无 cap（登录用户）→ 原子自增 study_seconds + ?', async () => {
    const conn = makeConn([logRow(100, 60)]) // 间隔 60s
    await accumulateStudyTime(conn, 10, 30) // 上报 30s
    const logSql = String(conn.execute.mock.calls[1][0])
    expect(logSql).toContain('study_seconds = study_seconds + ?')
    expect(conn.execute.mock.calls[1][1]).toEqual([30, 1]) // +30
    // stats 增量 = 30
    expect(conn.execute.mock.calls[2][1]).toEqual([30, 10])
  })

  it('有 cap 未触顶 → LEAST 原子更新，stats 加实际增量', async () => {
    const execute = vi.fn()
    execute.mockResolvedValueOnce([[logRow(50, 60)]]) // SELECT log（50s）
    execute.mockResolvedValueOnce([{ affectedRows: 1 }]) // UPDATE LEAST
    execute.mockResolvedValueOnce([[{ study_seconds: 80 }]]) // 回读新值
    execute.mockResolvedValue([{ affectedRows: 1 }]) // stats
    const conn = { execute } as any
    await accumulateStudyTime(conn, 10, 30, { dailyCapSeconds: 100 })
    const logSql = String(conn.execute.mock.calls[1][0])
    expect(logSql).toContain('LEAST(study_seconds + ?, ?)')
    expect(conn.execute.mock.calls[1][1]).toEqual([30, 100, 1]) // +30 封顶 100
    expect(conn.execute.mock.calls[3][1]).toEqual([30, 10]) // 实际增量 30
  })

  it('有 cap 部分触顶 → LEAST 封顶到 cap，stats 只加差额', async () => {
    const execute = vi.fn()
    execute.mockResolvedValueOnce([[logRow(90, 60)]]) // SELECT log（90s）
    execute.mockResolvedValueOnce([{ affectedRows: 1 }]) // UPDATE LEAST
    execute.mockResolvedValueOnce([[{ study_seconds: 100 }]]) // 回读新值（封顶）
    execute.mockResolvedValue([{ affectedRows: 1 }]) // stats
    const conn = { execute } as any
    await accumulateStudyTime(conn, 10, 30, { dailyCapSeconds: 100 })
    expect(conn.execute.mock.calls[1][1]).toEqual([30, 100, 1]) // LEAST(90+30, 100)
    expect(conn.execute.mock.calls[3][1]).toEqual([10, 10]) // 实际增量 10
  })

  it('有 cap 已达上限 → 回读后 realDelta=0 短路，不再累计', async () => {
    const execute = vi.fn()
    execute.mockResolvedValueOnce([[logRow(100, 60)]]) // SELECT log（100s=cap）
    execute.mockResolvedValueOnce([{ affectedRows: 1 }]) // UPDATE LEAST
    execute.mockResolvedValueOnce([[{ study_seconds: 100 }]]) // 回读仍 100
    const conn = { execute } as any
    await accumulateStudyTime(conn, 10, 30, { dailyCapSeconds: 100 })
    expect(conn.execute).toHaveBeenCalledTimes(3) // SELECT + UPDATE + 回读，无 stats
  })
})
