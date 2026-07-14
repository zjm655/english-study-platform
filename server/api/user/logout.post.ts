/**
 * 退出登录接口
 * 请求：POST /api/user/logout
 * 签发 1s 过期的 token 覆盖原 cookie，使旧 token 快速失效
 */
export default defineEventHandler(async (event): Promise<ResPayload<null>> => {
  const user = event.context.user

  const token = await signToken({ id: user.id, role: user.role }, '1s')
  setCookie(event, 'token', token, {
    httpOnly: true,
    secure: !import.meta.dev,
    sameSite: 'lax',
    maxAge: 1,
    path: '/',
  })

  return validateSuccess(null, '已退出登录')
})
