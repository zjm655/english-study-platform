import { useToVerify, useCheckinRefresh } from '~/composables/user'
import { useUserStore } from '~/store/useUserStore'

export default defineNuxtRouteMiddleware(async (to) => {
    if (import.meta.server || useUserStore().isVerify) return
    const verify = useToVerify()
    await verify.userToVerify()
    useUserStore().isVerify = true
    // 登录态确认后刷新连续天数（一次/会话，失败静默不阻断导航）
    try {
        const res = await useCheckinRefresh().execute()
        if (res?.code === 200 && res.data) {
            useUserStore().checkinStats = res.data
        }
    } catch {
        // 静默：刷新失败不影响页面访问
    }
})