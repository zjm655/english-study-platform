/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ensureGuestUser } from '../guestUser'

// db.query 供 getGuestDailyStudyCap 用；ensureGuestUser 走传入的 conn.execute
vi.mock('#server/utils/db', () => ({ query: vi.fn() }))

function makeConn(results: any[]) {
  const execute = vi.fn()
  for (const r of results) execute.mockResolvedValueOnce(r)
  return { execute } as any
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('ensureGuestUser 懒实体化', () => {
  it('已存在且未合并 → 返回该 id，仅一次 SELECT，不 INSERT', async () => {
    const conn = makeConn([[[{ id: 42, merged_into_user_id: null }]]])
    const res = await ensureGuestUser(conn, 'k1')
    expect(res).toEqual({ conflict: false, userId: 42 })
    expect(conn.execute).toHaveBeenCalledTimes(1)
  })

  it('已存在但已合并（残留 cookie）→ conflict:true', async () => {
    const conn = makeConn([[[{ id: 42, merged_into_user_id: 7 }]]])
    const res = await ensureGuestUser(conn, 'k1')
    expect(res.conflict).toBe(true)
    expect(conn.execute).toHaveBeenCalledTimes(1)
  })

  it('不存在 → INSERT（ON DUPLICATE 收敛）+ 建 stats，返回 insertId', async () => {
    const conn = makeConn([
      [[]], // SELECT 无行
      [{ insertId: 99, affectedRows: 1 }], // INSERT ... ON DUPLICATE KEY
      [{ affectedRows: 1 }], // INSERT IGNORE checkin_stats
    ])
    const res = await ensureGuestUser(conn, 'k-new')
    expect(res).toEqual({ conflict: false, userId: 99 })
    expect(conn.execute).toHaveBeenCalledTimes(3)
    // INSERT 语句含 ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)（并发收敛）
    const insertSql = String(conn.execute.mock.calls[1][0])
    expect(insertSql).toContain('ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)')
    // stats 用 INSERT IGNORE
    expect(String(conn.execute.mock.calls[2][0])).toContain('INSERT IGNORE INTO user_checkin_stats')
  })
})
