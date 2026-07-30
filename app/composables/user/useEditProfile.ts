import { updateProfile, changePassword, uploadAvatar } from '~/api/user/profile'
import type {
  UserProfileUpdatePayload,
  PasswordChangePayload,
  AvatarUploadResult,
} from '#shared/types/user'
import { useUserStore } from '~/store/useUserStore'

/**
 * 更新基本资料（昵称）业务 Hook：
 * 成功后把昵称局部合并进 store，不整刷 verify
 */
export function useUpdateProfile() {
  const updateCfg = createResCfg<UserProfileUpdatePayload, null>({
    handle: updateProfile,
    success: '修改成功',
    clientFail: '昵称校验未通过',
    serverFail: '服务器异常，请稍后重试',
    error: '网络异常，请检查网络',
    notify: 'all',
  })

  const { isLoading, execute } = useHandleRes(updateCfg)

  const handleUpdateProfile = async (payload: UserProfileUpdatePayload) => {
    const res = await execute(payload)
    if (res?.code === 200) {
      const userStore = useUserStore()
      // 局部更新昵称：避免整刷 verify 带来的额外请求
      if (userStore.user) {
        userStore.user = { ...userStore.user, nickname: payload.nickname }
      }
    }
    return res
  }

  return { isLoading, execute: handleUpdateProfile }
}

/**
 * 修改密码业务 Hook：
 * success 置空让 toast 回退到后端 message；成功时后端已清 token cookie，
 * 登出跳转（clearUser + clearNuxtData + navigateTo）由弹窗回调执行
 */
export function useChangePassword() {
  const changeCfg = createResCfg<PasswordChangePayload, null>({
    handle: changePassword,
    success: '',
    clientFail: '密码校验未通过',
    serverFail: '服务器异常，请稍后重试',
    error: '网络异常，请检查网络',
    notify: 'all',
  })

  const { isLoading, execute } = useHandleRes(changeCfg)

  return { isLoading, execute }
}

/**
 * 上传头像业务 Hook：
 * 成功后把返回的 avatarUrl 局部合并进 store，头像预览随 store 自动刷新
 */
export function useUploadAvatar() {
  const uploadCfg = createResCfg<FormData, AvatarUploadResult>({
    handle: uploadAvatar,
    success: '头像更新成功',
    clientFail: '头像上传失败，请检查图片格式与大小',
    serverFail: '服务器异常，请稍后重试',
    error: '网络异常，请检查网络',
    notify: 'all',
  })

  const { isLoading, execute } = useHandleRes(uploadCfg)

  const handleUploadAvatar = async (formData: FormData) => {
    const res = await execute(formData)
    if (res?.code === 200 && res.data?.avatarUrl) {
      const userStore = useUserStore()
      // 局部更新头像地址：避免整刷 verify
      if (userStore.user) {
        userStore.user = { ...userStore.user, avatarUrl: res.data.avatarUrl }
      }
    }
    return res
  }

  return { isLoading, execute: handleUploadAvatar }
}
