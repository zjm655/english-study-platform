// app/composables/admin/useChartOption.ts
// echarts option 工厂（P4-D4，落实 TECH_DEBT #3）：
// 统一折线图模板（tooltip/grid/xAxis/yAxis/渐变面积），cloud 五页 + stats 折线迁移到本工厂，
// 改图表风格只动这一处；bss 的 Pie/Bar 与 stats 的 Bar 差异大，保留页面内。
import { graphic } from 'echarts/core'

export interface LineSeriesSpec {
  name: string
  data: number[]
  /** 线条颜色（默认 #409EFF） */
  color?: string
  /** 是否显示渐变面积（默认 true） */
  area?: boolean
  /** 绑定的 Y 轴索引（双 Y 轴场景，默认 0） */
  yAxisIndex?: number
}

export interface LineChartOptionInput {
  /** X 轴类别（日期等） */
  xData: string[]
  /** 折线序列（单条或多条，双 Y 轴场景传多条） */
  series: LineSeriesSpec[]
  /** Y 轴名称（如「调用次数」「Token 数」） */
  yName?: string
  /** X 轴标签格式化（如长日期截断） */
  xLabelFormatter?: (value: string) => string
  /** 额外覆盖（如 legend 显隐、额外 series 类型） */
  overrides?: Record<string, unknown>
}

/**
 * 统一折线图 option：tooltip/grid/xAxis/yAxis/渐变面积一次定义，
 * 页面差异经 overrides 覆盖；series 类型用 `as const` 之外的宽松类型兼容 echarts 6。
 */
export function buildLineChartOption(input: LineChartOptionInput): Record<string, unknown> {
  const { xData, series, yName, xLabelFormatter, overrides } = input
  return {
    tooltip: { trigger: 'axis' },
    grid: { left: 45, right: 20, top: 30, bottom: 40 },
    xAxis: {
      type: 'category',
      data: xData,
      axisLabel: {
        fontSize: 11,
        formatter: xLabelFormatter ?? ((v: string) => (v.length >= 10 ? v.slice(5) : v)),
      },
    },
    yAxis: {
      type: 'value',
      ...(yName ? { name: yName } : {}),
      axisLabel: { fontSize: 11 },
      splitLine: { show: false },
    },
    series: series.map((s) => ({
      name: s.name,
      type: 'line',
      data: s.data,
      smooth: true,
      itemStyle: { color: s.color ?? '#409EFF' },
      ...(s.yAxisIndex !== undefined ? { yAxisIndex: s.yAxisIndex } : {}),
      ...(s.area === false
        ? {}
        : {
            areaStyle: {
              color: new graphic.LinearGradient(0, 0, 0, 1, [
                { offset: 0, color: (s.color ?? '#409EFF') + '40' },
                { offset: 1, color: (s.color ?? '#409EFF') + '05' },
              ]),
            },
          }),
    })),
    ...overrides,
  }
}
