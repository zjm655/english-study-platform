module.exports = {
  apps: [
    {
      name: 'english-platform',
      script: '.output/server/index.mjs',
      // 部署目录（按本机实际路径修改）
      cwd: '/opt/test',
      exec_mode: 'fork',
      instances: 1,
      node_args: '--env-file=.env',
      // 内存超限自动重启兜底（按服务器规格调整）
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        // 生产端口（devServer 的 5173 仅开发生效，生产 Nitro 默认 3000）
        PORT: '3000',
        // 是否信任 X-Forwarded-For（P3-A）：pm2 直连部署必须 'false'（无 nginx 覆盖 XFF，
        // 信任链头会取客户端伪造值击穿 IP 级限流）；若前面有 nginx 且已覆盖 XFF 则可为 'true'
        NUXT_TRUST_PROXY: 'false',
        // JWT密钥
        // 文件日志保留天数（logs/ 下超期 .log 文件在服务启动时自动清理）；留空默认 30
        NUXT_LOG_RETENTION_DAYS: '30',
        NUXT_JWT_SECRET: '',
        // 数据库
        NUXT_DB_HOST: 'localhost',
        NUXT_DB_PORT: '3306',
        NUXT_DB_USER: 'nuxt',
        NUXT_DB_PASSWORD: '',
        NUXT_DB_DATABASE: 'nuxt4_demo',
        // 日志开关
        NUXT_PUBLIC_IS_OPEN_LOG: 'false',
        NUXT_IS_OPEN_LOG: 'true',
        // 阿里云 OSS
        NUXT_OSS_REGION: '',
        NUXT_OSS_BUCKET: '',
        NUXT_OSS_ACCESS_KEY_ID: '',
        NUXT_OSS_ACCESS_KEY_SECRET: '',
        // 公网部署到阿里云 ECS 同 region 时设为 true，走内网免流量费
        NUXT_OSS_USE_INTERNAL: 'true',
        // DeepSeek
        NUXT_DEEPSEEK_MODEL: '',
        NUXT_DEEPSEEK_API_KEY: '',
        NUXT_DEEPSEEK_BASE_URL: '',
        // 阿里云智能语音 NLS
        NUXT_NLS_ACCESS_KEY_ID: '',
        NUXT_NLS_ACCESS_KEY_SECRET: '',
        NUXT_NLS_GATEWAY: '',
        NUXT_NLS_APP_KEY: '',
        // 智能科教内容生成平台
        NUXT_AI_CONTENT_APP_ID: '',
        NUXT_AI_CONTENT_APP_SECRET: '',
        NUXT_AI_CONTENT_ACCESS_KEY_ID: '',
        NUXT_AI_CONTENT_ACCESS_KEY_SECRET: '',
        // 评测鉴权接口地址（段名 AI_CONTENT 驼峰拆分，勿写成 AICONTENT——否则注入无效、恒用默认值）
        NUXT_AI_CONTENT_AUTH_URL: '',
        // 云产品调用与账单查询
        NUXT_BSS_ACCESS_KEY_ID: '',
        NUXT_BSS_ACCESS_KEY_SECRET: '',
        // ============ 启动期自举超级管理员（可选） ============
        NUXT_SUPER_ADMIN_ACCOUNT: '',
        NUXT_SUPER_ADMIN_PASSWORD: '',
        NUXT_SUPER_ADMIN_NICKNAME: '',
        NUXT_SUPER_ADMIN_EMAIL: '',
        // 危险开关：仅当值为 'true' 或 '1' 时生效
        NUXT_SUPER_ADMIN_FORCE_REPLACE: 'false',

        NUXT_TTS_PROXY_URL: '',
        NUXT_TTS_PROXY_KEY: '',
      },
    },
  ],
}
