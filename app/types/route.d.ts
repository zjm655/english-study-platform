// 扩展 vue-router 的 RouteMeta，支持 definePageMeta 中的自定义字段
declare module 'vue-router' {
  interface RouteMeta {
    /** 页面标题，显示在 header 中间 */
    title?: string
    /** 隐藏底部 TabBar（如登录页、Phase详情页） */
    hideTabBar?: boolean
    /** 隐藏顶部 Header（如全屏页面） */
    hideHeader?: boolean
    /** 解除 default 布局的 430px 限宽（如登录页 PC 双栏） */
    fullWidth?: boolean
    isHome?: boolean
  }
}

export {}
