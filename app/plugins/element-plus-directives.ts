import { ElInfiniteScroll } from 'element-plus'

/**
 * 注册 Element Plus 指令。
 * @element-plus/nuxt 按需解析模板中的组件，但 `v-infinite-scroll` 这类指令
 * 不一定被自动注册，这里显式全局注册以保证单元详情页无限滚动生效。
 */
export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.vueApp.directive('infinite-scroll', ElInfiniteScroll)
})
