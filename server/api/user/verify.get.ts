import { query } from '#server/utils/db'
import type { UserRow } from '#server/types/db'
import { getUserPermissions } from '#server/services/permission'
import { signAvatarUrl } from '#server/utils/oss'
import { isSuperAdmin, isAdminOrAbove } from '#shared/utils/role'
import { ALL_PERMISSIONS } from '#shared/utils/permission'

export default defineEventHandler(async (event) => {
  const userId = event.context.user.id
  const rows = await query<UserRow>(
    'SELECT id, account, nickname, email, role, passwordHash, avatarUrl, level FROM user WHERE id = ?',
    [userId],
  )
  const user = rows[0]
  if (!user) {
    return validateError('账号不存在', 401)
  }

  // 续期：重新签发 token，滑动窗口 7 天
  const token = await signToken({ id: user.id, role: user.role })
  setCookie(event, 'token', token, {
    httpOnly: true,
    secure: !import.meta.dev,
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 7,
    path: '/',
  })

  const { passwordHash, ...safeInfo } = user
  // 头像为私有对象，下发前签名为临时可访问 URL
  safeInfo.avatarUrl = await signAvatarUrl(safeInfo.avatarUrl)
  // 下发权限键供前端展示控制（体验层，安全以后端为准）：普通用户零查询，超管为全权哨兵。
  let permissions: string[] = []
  if (isSuperAdmin(user.role)) permissions = ALL_PERMISSIONS
  else if (isAdminOrAbove(user.role)) permissions = [...(await getUserPermissions(user.id))]
  return validateSuccess({ ...safeInfo, permissions }, '登录状态校验通过！', 200)
})
