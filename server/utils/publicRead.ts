// server/utils/publicRead.ts
// 可选鉴权的公开只读路径判定：命中路径的游客请求（无 token）在 auth 中间件直接放行，
// 不挂 event.context.user；持 token 的请求仍走完整验证流程（登录用户行为不变）。
// handler 侧必须按 event.context.user 有无做游客裁剪（无签名 URL、无进度）。

/** 公开只读路径：GET /api/units（单元列表）、GET /api/units/:id/progress（单元详情）、GET /api/segment/:segId（片段详情）与 GET /api/config/upload-limits（上传限制配置） */
export function isPublicReadPath(method: string, path: string): boolean {
  if (method !== 'GET') return false
  // event.path 含 query string（既有陷阱），先剥离再匹配
  const pathname = path.split('?')[0] ?? path
  return (
    pathname === '/api/units' ||
    pathname === '/api/config/upload-limits' ||
    /^\/api\/units\/\d+\/progress$/.test(pathname) ||
    /^\/api\/segment\/\d+$/.test(pathname)
  )
}
