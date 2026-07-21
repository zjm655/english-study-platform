/**
 * 主题状态管理（light / dark / auto）
 *
 * 职责：
 * - 读取/持久化主题偏好到 localStorage
 * - 设置 document.documentElement 的 data-theme 属性
 * - 监听系统 prefers-color-scheme 变化（auto 模式）
 */

type Theme = 'light' | 'dark' | 'auto'

const theme = ref<Theme>('auto')
let mediaListener: ((e: MediaQueryListEvent) => void) | null = null

function applyTheme(t: Theme): void {
  const isDark =
    t === 'dark' || (t === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light')
}

function init(): void {
  const stored = localStorage.getItem('theme') as Theme | null
  theme.value = stored || 'auto'
  applyTheme(theme.value)

  // 监听系统主题变化（auto 模式下自动跟随）
  if (!mediaListener) {
    mediaListener = () => {
      if (theme.value === 'auto') applyTheme('auto')
    }
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', mediaListener)
  }
}

function setTheme(t: Theme): void {
  theme.value = t
  localStorage.setItem('theme', t)
  applyTheme(t)
}

export function useTheme() {
  return { theme: readonly(theme), setTheme, init }
}
