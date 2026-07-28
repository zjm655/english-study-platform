// app/composables/admin/useChartResize.ts：echarts 图表容器尺寸自适应 + 生命周期统一管理
import type { EChartsType } from 'echarts/core'
import type { Ref } from 'vue'

export interface ChartResizeEntry {
  /** 取图表实例（页面用 let 变量惰性初始化，故用 getter 而非直接传实例） */
  getChart: () => EChartsType | null | undefined
  /** 图表容器 ref（可能因 v-if 延迟出现，内部 watch 出现后再 observe） */
  containerRef: Readonly<Ref<HTMLElement | null | undefined>>
}

export interface ChartResizeOptions {
  /** 卸载时是否 dispose 图表实例（默认 true；页面自行 dispose 时传 false 避免双重释放） */
  dispose?: boolean
}

/**
 * 用单个 ResizeObserver 监听多个图表容器，尺寸变化时对对应图表调 resize()；
 * onUnmounted 时 disconnect 并（默认）dispose 所有图表实例。
 * 容器尺寸变化来源：侧边栏固定、主内容区随窗口变化（对齐 stats 页原实现）。
 */
export function useChartResize(entries: ChartResizeEntry[], options: ChartResizeOptions = {}) {
  const { dispose = true } = options
  let observer: ResizeObserver | null = null

  onMounted(() => {
    observer = new ResizeObserver((records) => {
      for (const record of records) {
        const entry = entries.find((e) => e.containerRef.value === record.target)
        entry?.getChart()?.resize()
      }
    })
    // 容器可能在 v-if 数据就绪后才渲染，watch 出现/替换时增量 observe
    for (const entry of entries) {
      watch(
        () => entry.containerRef.value,
        (el, prev) => {
          if (prev) observer?.unobserve(prev)
          if (el) observer?.observe(el)
        },
        { immediate: true },
      )
    }
  })

  onUnmounted(() => {
    observer?.disconnect()
    observer = null
    if (!dispose) return
    for (const entry of entries) {
      const chart = entry.getChart()
      if (chart && !chart.isDisposed()) chart.dispose()
    }
  })
}
