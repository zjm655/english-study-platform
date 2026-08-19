/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ensureGuestUser, getGuestDailyStudyCap } from '../guestUser'

// 配置读取已接入 configStore（模块内不再自建缓存）：mock getSysConfigKeys；
// ensureGuestUser 走传入的 conn.execute，不依赖 db。
const { mockGetSysConfigKeys } = vi.hoisted(() => ({
  mockGetSysConfigKeys: vi.fn(),
}))

vi.mock('#server/utils/configStore', () => ({ getSysConfigKeys: mockGetSysConfigKeys }))

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

// ============ getGuestDailyStudyCap（经 configStore） ============

describe('getGuestDailyStudyCap', () => {
  it('配置有效值 → 返回配置值（单键读取）', async () => {
    mockGetSysConfigKeys.mockResolvedValueOnce(new Map([['guest_daily_study_cap', '7200']]))
    expect(await getGuestDailyStudyCap()).toBe(7200)
    expect(mockGetSysConfigKeys).toHaveBeenCalledWith(['guest_daily_study_cap'])
  })

  it('缺键（空 Map）→ 兑底默认 4h', async () => {
    mockGetSysConfigKeys.mockResolvedValueOnce(new Map())
    expect(await getGuestDailyStudyCap()).toBe(14400)
  })

  it('configStore 抛错 → 兑底默认 4h，不阻断上报', async () => {
    mockGetSysConfigKeys.mockRejectedValueOnce(new Error('configStore down'))
    expect(await getGuestDailyStudyCap()).toBe(14400)
  })

  it.each([['-5'], ['abc'], ['0']])('非法值 %s → 兑底默认 4h', async (raw) => {
    mockGetSysConfigKeys.mockResolvedValueOnce(new Map([['guest_daily_study_cap', raw]]))
    expect(await getGuestDailyStudyCap()).toBe(14400)
  })

  it('小数向下取整', async () => {
    mockGetSysConfigKeys.mockResolvedValueOnce(new Map([['guest_daily_study_cap', '7200.9']]))
    expect(await getGuestDailyStudyCap()).toBe(7200)
  })

  it('模块内无缓存：连续两次读取均经 configStore，第二次读到新值', async () => {
    mockGetSysConfigKeys.mockResolvedValueOnce(new Map([['guest_daily_study_cap', '3600']]))
    expect(await getGuestDailyStudyCap()).toBe(3600)
    mockGetSysConfigKeys.mockResolvedValueOnce(new Map([['guest_daily_study_cap', '1800']]))
    expect(await getGuestDailyStudyCap()).toBe(1800)
    expect(mockGetSysConfigKeys).toHaveBeenCalledTimes(2)
  })
})
