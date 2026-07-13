import { useToVerify } from '~/composables/user'
import { useUserStore } from '~/store/useUserStore'

export default defineNuxtRouteMiddleware((to) => {
    if (import.meta.server || useUserStore().isVerify) return
    const verify = useToVerify()
    verify.userToVerify()
    useUserStore().isVerify = true
})