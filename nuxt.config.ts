// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: process.env.NODE_ENV === 'development' },
  css: ['~/assets/css/global.css'],
  app: {
    head: {
      script: [
        // 评测 SDK（368KB）：必须全局 head + defer，且**不可**改为 bodyClose/按需动态注入——
        // 它是 Emscripten 产物，用 `typeof process === 'object'` 判断 Node 环境；若排在 Nuxt entry
        // 之后执行，entry 已注入 window.process 垫片，SDK 会误判为 Node 走 require("fs") 直接报错。
        // head + defer 保证它按文档顺序先于 entry 执行（就绪判定由 ensureSDKLoaded 轮询完成）
        { src: '/sdk/engine.js', defer: true },
        // 防闪烁脚本：页面渲染前设置 data-theme，避免深色模式下白屏闪烁
        {
          innerHTML: `(function(){var t=localStorage.getItem('theme')||'auto';var d=t==='dark'||(t==='auto'&&window.matchMedia('(prefers-color-scheme:dark)').matches);document.documentElement.setAttribute('data-theme',d?'dark':'light')})()`,
          type: 'text/javascript',
        },
      ],
    },
  },
  // 管理后台无 SEO 需求且是水合不匹配重灾区，整体关闭 SSR（纯 CSR）
  routeRules: {
    '/admin/**': { ssr: false },
  },
  runtimeConfig: {
    public: {
      isOpenLog: true,
    },
    jwtSecret: '',
    isOpenLog: true,
    // 文件日志保留天数（logs/ 下超期 .log 启动时清理），env: NUXT_LOG_RETENTION_DAYS
    logRetentionDays: 30,
    db: {
      host: '127.0.0.1',
      port: '3306',
      user: 'root',
      password: '',
      database: 'nuxt4_demo',
    },
    oss: {
      region: 'oss-cn-wuhan-lr',
      bucket: 'nick-img-bucket-xxxxxx-from-xxx',
      accessKeyId: '',
      accessKeySecret: '',
      useInternal: false,
    },
    deepseek: {
      model: 'deepseek-v4-flash',
      apiKey: '',
      baseUrl: '',
    },
    nls: {
      accessKeyId: '',
      accessKeySecret: '',
      gateway: 'nls-gateway.aliyuncs.com',
      appKey: '',
    },
    // Edge TTS 代理（Cloudflare Worker 中转，解决服务器公网 IP 被微软封锁）；
    // url 留空则直连微软（本地开发默认），非空时 key 必须与 Worker 的 PROXY_KEY 一致
    ttsProxy: {
      url: '',
      key: '',
    },
    aiContent: {
      appId: '',
      appSecret: '',
      accessKeyId: '',
      accessKeySecret: '',
      authUrl: 'https://api.cloud.ssapi.cn/auth/authorize',
    },
    bss: {
      accessKeyId: '',
      accessKeySecret: '',
    },
    // 启动期自举全局唯一超级管理员（env 注入；account/password 皆空则不启用）
    superAdmin: {
      account: '',
      password: '',
      nickname: '',
      email: '',
      forceReplace: false,
    },
  },
  modules: ['@element-plus/nuxt', '@pinia/nuxt'],
  elementPlus: {
    // 默认就是按需导入，不用额外配置
  },
  typescript: {
    typeCheck: false, // 启用构建时的类型检查
    tsConfig: {
      exclude: ['**/__tests__/**', '**/*.spec.ts', '**/*.test.ts'],
    },
  },
  devServer: {
    port: 5173,
  },

  // 关闭构建 sourcemap（Nuxt 默认 server 开启）：1.8G 小内存服务器上
  // Nitro server 打包阶段生成大量 map 是构建 OOM（被内核 Killed）的主要内存开销之一；
  // 生产排障主要靠 DB 埋点 + logs/ 文件日志（requestId 互查），server sourcemap 价值低
  sourcemap: {
    server: false,
    client: false,
  },

  nitro: {
    externals: {
      trace: false,
    },
    // 同上：Nitro 自身的 sourcemap 开关与顶层 sourcemap 独立，需单独关闭
    sourceMap: false,
    // 显式关闭 server 产物 minify（保险项：node-server 预设默认大概率已关，
    // 显式声明防未来预设默认值变化）；esbuild 为 Go 原生，内存不受 --max-old-space-size 管控；
    // server bundle 在本机运行无下行流量，体积换构建内存，运行性能无感
    minify: false,
  },
})
