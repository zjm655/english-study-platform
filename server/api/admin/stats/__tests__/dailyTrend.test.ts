import { describe, it, expect, vi } from 'vitest'
import { fillDailyTrendZeros } from '../index.get'

// Nuxt 自动导入的符号在 vitest node 环境需手动挂全局（同 user.test.ts 先例）
vi.hoisted(() => {
  ;(globalThis as unknown as Record<string, unknown>).defineEventHandler = (h: unknown) => h
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
