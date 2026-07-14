import pool from '#server/utils/db'  

export default defineEventHandler(async (event) => {
    const userId = event.context.user.id
    const [rows] = await pool.execute(
        'SELECT id, account, nickname, email, role, passwordHash, avatarUrl, level FROM user WHERE id = ?',
        [userId]
      )
      const user = (rows as any[])[0]
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
      return validateSuccess(safeInfo, "登录状态校验通过！", 200)
})