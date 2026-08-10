/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi } from 'vitest'
import handler, { fillDailyZeros, type TrendAggRow } from '../trend.get'
import { startDateOf } from '#server/utils/dateSeries'
import { query } from '#server/utils/db'

// Nuxt 自动导入的符号在 vitest node 环境需手动挂全局（同 user.test.ts 先例）
vi.hoisted(() => {
  ;(globalThis as unknown as Record<string, unknown>).defineEventHandler = (h: unknown) => h
  ;(globalThis as unknown as Record<string, unknown>).getQuery = (event: unknown) => (event as Record<string, unknown>).__query ?? {}
})

// 模块加载依赖链：db.ts 顶层读 useRuntimeConfig、permission.ts 透传引入 oss.ts，
// node 测试环境需 mock 避免崩溃（同 user.test.ts 先例）。本测试只测纯函数，不触发 handler。
vi.mock('#server/utils/db', () => ({ query: vi.fn() }))
vi.mock('#server/utils/oss', () => ({ signUrl: vi.fn(), MATERIAL_EXPIRE: 2100 }))

// fillDailyZeros / startDateOf 为纯函数（无 db 依赖），直接测补零语义：
// 「无调用日期显示为 0」必须对 callCounts/totalDurations/totalTokens 各分量逐一补 0，
// 保证前端折线/面积图不跨空日期直连。

const SAMPLE: TrendAggRow[] = [
  { date: '2026-08-01', call_count: 3, total_duration: 1200, total_tokens: 5000 },
  { date: '2026-08-05', call_count: 2, total_duration: 800, total_tokens: 3000 },
]

describe('fillDailyZeros - 按天补零', () => {
  it('中间日期缺失：8.2~8.4 各分量均补 0，序列完整含首尾', () => {
    const { dates, callCounts, totalDurations, totalTokens } = fillDailyZeros(
      '2026-08-01',
      '2026-08-05',
      SAMPLE,
    )
    expect(dates).toEqual([
      '2026-08-01',
      '2026-08-02',
      '2026-08-03',
      '2026-08-04',
      '2026-08-05',
    ])
    expect(callCounts).toEqual([3, 0, 0, 0, 2])
    expect(totalDurations).toEqual([1200, 0, 0, 0, 800])
    expect(totalTokens).toEqual([5000, 0, 0, 0, 3000])
  })

  it('首尾日期缺失：区间首日与末日无数据时补 0，不压缩序列', () => {
    // 区间 7 天（8.1~8.7），仅中间 8.3/8.4 有数据
    const rows: TrendAggRow[] = [
      { date: '2026-08-03', call_count: 1, total_duration: 100, total_tokens: 10 },
      { date: '2026-08-04', call_count: 2, total_duration: 200, total_tokens: 20 },
    ]
    const { dates, callCounts } = fillDailyZeros('2026-08-01', '2026-08-07', rows)
    expect(dates).toHaveLength(7)
    expect(dates[0]).toBe('2026-08-01')
    expect(dates[6]).toBe('2026-08-07')
    expect(callCounts).toEqual([0, 0, 1, 2, 0, 0, 0])
  })

  it('查询区间完全无数据：rows 为空数组，全序列各分量均为 0', () => {
    const { dates, callCounts, totalDurations, totalTokens } = fillDailyZeros(
      '2026-08-01',
      '2026-08-03',
      [],
    )
    expect(dates).toHaveLength(3)
    expect(callCounts).toEqual([0, 0, 0])
    expect(totalDurations).toEqual([0, 0, 0])
    expect(totalTokens).toEqual([0, 0, 0])
  })

  it('nls 分支 useBizAsDuration=true：totalDurations 取 total_biz（真实音频时长），其余分量仍补 0', () => {
    const rows: TrendAggRow[] = [
      { date: '2026-08-02', call_count: 4, total_biz: 3_600_000 },
    ]
    const { dates, callCounts, totalDurations, totalTokens } = fillDailyZeros(
      '2026-08-01',
      '2026-08-04',
      rows,
      { useBizAsDuration: true },
    )
    expect(dates).toHaveLength(4)
    expect(callCounts).toEqual([0, 4, 0, 0])
    expect(totalDurations).toEqual([0, 3_600_000, 0, 0])
    expect(totalTokens).toEqual([0, 0, 0, 0])
  })

  it('mysql2 聚合值可能为字符串（DECIMAL/COUNT），Number 转换后正确补零', () => {
    const rows: TrendAggRow[] = [
      { date: '2026-08-02', call_count: '5', total_duration: '1500', total_tokens: '900' },
    ]
    const { callCounts, totalDurations, totalTokens } = fillDailyZeros(
      '2026-08-02',
      '2026-08-02',
      rows,
    )
    expect(callCounts).toEqual([5])
    expect(totalDurations).toEqual([1500])
    expect(totalTokens).toEqual([900])
  })
})

describe('startDateOf - 区间起点推算', () => {
  it('days=7：起点 = today - 6 天（跨月进位正确）', () => {
    expect(startDateOf('2026-08-08', 7)).toBe('2026-08-02')
    expect(startDateOf('2026-08-03', 7)).toBe('2026-07-28') // 跨月
  })

  it('days=1：起点 = 终点（单日区间）', () => {
    expect(startDateOf('2026-08-08', 1)).toBe('2026-08-08')
  })
})

describe('trend handler 集成 - today 取 DB 时区字符串（回归 329d4e7）', () => {
  it('today 查询使用 DATE_FORMAT 强制字符串，且序列完整含数据落位', async () => {
    // 修复点：today 查询必须用 DATE_FORMAT 输出 YYYY-MM-DD 字符串。mysql2 dateStrings=false 时
    // 裸 CURDATE() 的 DATE 列返回 JS Date 对象，模板字符串拼出 Invalid Date → 补零序列全空。
    // 329d4e7 把 todayRows[0]?.today 改为 todayRow?.today 后不再走 fallback，暴露该问题。
    vi.mocked(query)
      .mockResolvedValueOnce([{ today: '2026-08-10' }]) // DATE_FORMAT 输出的字符串
      .mockResolvedValueOnce([
        { date: '2026-08-10', call_count: 6, total_duration: 1378, total_tokens: 0 },
      ])

    const res = await handler({
      __query: { service: 'oss', days: 7 },
      context: { user: { role: 1, permissions: ['view_stats'] } },
    } as any)

    // 固化修复：today 查询必须走 DATE_FORMAT（改回 CURDATE() 时此断言失败）
    const [todaySql] = vi.mocked(query).mock.calls[0]!
    expect(todaySql).toContain("DATE_FORMAT(CURDATE(), '%Y-%m-%d')")

    // 行为验证：字符串 today → 完整 7 天序列，数据正确落位
    expect(res.code).toBe(200)
    expect(res.data!.dates).toHaveLength(7)
    expect(res.data!.dates[6]).toBe('2026-08-10')
    expect(res.data!.callCounts).toHaveLength(7)
    expect(res.data!.callCounts[6]).toBe(6)
  })
})
