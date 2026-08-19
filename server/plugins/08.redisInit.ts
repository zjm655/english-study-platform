// server/plugins/08.redisInit.ts
// Redis 启动探测（P0）：Nitro 启动时 fire-and-forget 调用 getRedis() 触发 redisConn 懒初始化，
// 使连接状态开机即可见（就绪/未配置/降级提示与告警均由 redisConn 状态机负责，本插件不重复判定）。
// 不阻塞启动、失败不致启动失败；close 钩子优雅 disconnect（对齐 apiCallLogger 的 close 用法）。
import { getRedis, closeRedis } from '#server/utils/redisConn'

export default defineNitroPlugin((nitroApp) => {
  // fire-and-forget：仅触发初始化与后台连接，不 await
  void getRedis()

  nitroApp.hooks.hook('close', async () => {
    await closeRedis()
  })
})
