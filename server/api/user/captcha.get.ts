// server/api/user/captcha.get.ts
// 图形验证码获取接口（公开，无需登录，已在 auth 中间件白名单）
// GET /api/user/captcha → { svg, token }
import { generateCaptcha } from '#server/utils/captcha'

export default defineEventHandler(async () => {
  const { svg, token } = await generateCaptcha()
  return validateSuccess({ svg, token }, '获取验证码成功')
})
