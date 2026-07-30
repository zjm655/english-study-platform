import { getUnreadCount } from '~/api/notice'
import { useUserStore } from '~/store/useUserStore'

/**
 * 未读公告数（首页铃铛红点）：
 * 严格客户端拉取——由组件在 onMounted 后调用 refresh，不在 setup 顶层发请求（SSR 安全）；
 * refresh 内部按登录态守卫，游客不发请求，红点恒不显示
 */
export const useNoticeUnread = () => {
  const unreadCount = ref(0)

  const cfg = createResCfg<null, { unreadCount: number }>({
    handle: getUnreadCount,
    success: '获取未读数成功',
    clientFail: '获取未读数失败',
    serverFail: '服务器异常，获取未读数失败',
    error: '网络异常，请检查网络',
  })
  const { isLoading, execute } = useHandleRes(cfg)

  /** 刷新未读数（未登录直接跳过，不发请求） */
  const refresh = async () => {
    const userStore = useUserStore()
    if (!userStore.isLogin) return
    const res = await execute(null)
    if (res?.code === 200 && res.data) {
      unreadCount.value = res.data.unreadCount
    }
  }

  return { unreadCount, isLoading, refresh }
}
