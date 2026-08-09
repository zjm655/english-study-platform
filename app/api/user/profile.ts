import { userProfilePath, userPasswordPath, userAvatarPath } from '~/api/paths'
import type {
  UserProfileUpdatePayload,
  PasswordChangePayload,
  AvatarUploadResult,
} from '#shared/types/user'

/** 更新基本资料（昵称 1-25 字） */
export const updateProfile = async (payload: UserProfileUpdatePayload) => {
  return request.json<null>(userProfilePath, {
    method: 'PUT',
    body: payload,
  })
}

/** 修改密码（成功时后端已清除 token cookie，调用方需执行登出流程） */
export const changePassword = async (payload: PasswordChangePayload) => {
  return request.json<null>(userPasswordPath, {
    method: 'POST',
    body: payload,
  })
}

/** 上传头像（multipart FormData，文件字段名 file，不设 Content-Type 由浏览器生成 boundary） */
export const uploadAvatar = async (formData: FormData) => {
  return request.file<AvatarUploadResult>(userAvatarPath, {
    method: 'POST',
    body: formData,
  })
}
