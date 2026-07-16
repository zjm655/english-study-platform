import { useToVerify } from '~/composables/user'
import { useUserStore } from '~/store/useUserStore'

export default defineNuxtRouteMiddleware(async (to) => {
    if (import.meta.server || useUserStore().isVerify) return
    const verify = useToVerify()
    await verify.userToVerify()
    useUserStore().isVerify = true
})