// stores/user.ts
export const useUserStore = defineStore('user', () => {
  const user = ref<LoginResPayload | null>(null)
  const isLogin = ref<boolean>(false)

  function setUser(data: LoginResPayload) {
    user.value = data
  }

  return { user, isLogin, setUser }
})