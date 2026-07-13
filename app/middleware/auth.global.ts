import { useToVerify } from '~/composables/user'

export default defineNuxtRouteMiddleware((to) => {
    if (import.meta.server) return
    const verify = useToVerify()
    verify.userToVerify()
})