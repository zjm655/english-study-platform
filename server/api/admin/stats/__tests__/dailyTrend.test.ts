/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi } from 'vitest'
import handler, { fillDailyTrendZeros } from '../index.get'
import { query } from '#server/utils/db'

// Nuxt 自动导入的符号在 vitest node 环境需手动挂全局（同 user.test.ts 先例）
vi.hoisted(() => {
  ;(globalThis as unknown as Record<string, unknown>).defineEventHandler = (h: unknown) => h
  ;(globalThis as unknown as Record<string, unknown>).getQuery = (event: unknown) =>
    (event as Record<string, unknown>).__query ?? {}
})

// 模块加载依赖链：db.ts 顶层读 useRuntimeConfig、permission.ts 透传引入 oss.ts，
// node 测试环境需 mock 避免崩溃（同 user.test.ts 先例）。本测试只测纯函数，不触发 handler。
vi.mock('#server/utils/db', () => ({ query: vi.fn() }))
vi.mock('#server/utils/oss', () => ({ signUrl: vi.fn(), MATERIAL_EXPIRE: 2100 }))

// fillDailyTrendZeros 为纯函数（无 db 依赖），直接测运营统计按天趋势的补零语义：
// 「无调用日期显示为 0」必须对 count/errorCount/avgDuration 各分量逐一补 0，
// 与 cloud 趋势接口（trend.get.ts 的 fillDailyZeros）保持全站一致的曲线语义。

describe('fillDailyTrendZeros - 运营统计按天补零', () => {
  it('中间日期缺失：缺日 count/errorCount/avgDuration 均补 0', () => {
    const items = fillDailyTrendZeros('2026-08-01', '2026-08-05', [
      { date: '2026-08-01', count: 10, errorCount: 2, avgDuration: 120 },
      { date: '2026-08-05', count: 5, errorCount: 1, avgDuration: 80 },
    ])
    expect(items.map((i) => i.date)).toEqual([
      '2026-08-01',
      '2026-08-02',
      '2026-08-03',
      '2026-08-04',
      '2026-08-05',
    ])
    expect(items.map((i) => i.count)).toEqual([10, 0, 0, 0, 5])
    expect(items.map((i) => i.errorCount)).toEqual([2, 0, 0, 0, 1])
    expect(items.map((i) => i.avgDuration)).toEqual([120, 0, 0, 0, 80])
  })

  it('首尾日期缺失：区间首日与末日无数据时补 0，不压缩序列', () => {
    const items = fillDailyTrendZeros('2026-08-01', '2026-08-07', [
      { date: '2026-08-03', count: 3, errorCount: 0, avgDuration: 50 },
    ])
    expect(items).toHaveLength(7)
    expect(items[0]!.count).toBe(0)
    expect(items[6]!.count).toBe(0)
    expect(items[2]!.count).toBe(3)
  })

  it('查询区间完全无数据：rows 为空数组，全序列各分量均为 0', () => {
    const items = fillDailyTrendZeros('2026-08-01', '2026-08-03', [])
    expect(items).toHaveLength(3)
    expect(items.every((i) => i.count === 0 && i.errorCount === 0 && i.avgDuration === 0)).toBe(
      true,
    )
  })
})

describe('stats handler 集成 - today 取 DB 时区字符串（回归 329d4e7）', () => {
  it('today 查询使用 DATE_FORMAT 强制字符串，且 dailyTrend 序列完整', async () => {
    // 修复点：today 查询必须用 DATE_FORMAT 输出 YYYY-MM-DD 字符串（与 trend.get.ts 同源）。
    // 裸 CURDATE() 在 mysql2 dateStrings=false 下返回 JS Date 对象，模板字符串拼出 Invalid Date →
    // startDateOf 产出 NaN 日期 → fillDailyTrendZeros while 不执行 → dailyTrend 全空。
    vi.mocked(query)
      .mockResolvedValueOnce([
        {
          totalCalls: 10,
          avgDuration: 50,
          errorRate: 0,
          businessErrorRate: 0,
          activeUsers: 1,
          unauthCalls: 0,
          todayCalls: 3,
        },
      ]) // summary
      .mockResolvedValueOnce([{ today: '2026-08-10' }]) // today（DATE_FORMAT 输出的字符串）
      .mockResolvedValueOnce([{ date: '2026-08-10', count: 3, errorCount: 0, avgDuration: 50 }]) // trendRows
      .mockResolvedValueOnce([]) // topRows
      .mockResolvedValueOnce([]) // errRows

    const res = await handler({
      __query: { days: 7 },
      context: { user: { role: 1, permissions: ['view_stats'] } },
    } as any)

    // 固化修复：第 2 次查询（today）必须走 DATE_FORMAT（改回 CURDATE() 时此断言失败）
    const [todaySql] = vi.mocked(query).mock.calls[1]!
    expect(todaySql).toContain("DATE_FORMAT(CURDATE(), '%Y-%m-%d')")

    // 行为验证：字符串 today → dailyTrend 完整 7 天序列，数据正确落位
    expect(res.code).toBe(200)
    expect(res.data!.dailyTrend).toHaveLength(7)
    expect(res.data!.dailyTrend[0]!.date).toBe('2026-08-04')
    expect(res.data!.dailyTrend[6]!.date).toBe('2026-08-10')
    expect(res.data!.dailyTrend[6]!.count).toBe(3)
  })
})
