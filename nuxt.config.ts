// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: process.env.NODE_ENV === 'development' },
  css: ['~/assets/css/global.css'],
  app: {
    head: {
      script: [
        { src: '/sdk/engine.js', defer: true },
        // 防闪烁脚本：页面渲染前设置 data-theme，避免深色模式下白屏闪烁
        {
          innerHTML: `(function(){var t=localStorage.getItem('theme')||'auto';var d=t==='dark'||(t==='auto'&&window.matchMedia('(prefers-color-scheme:dark)').matches);document.documentElement.setAttribute('data-theme',d?'dark':'light')})()`,
          type: 'text/javascript',
        },
      ],
    },
  },
  runtimeConfig: {
    public: {
      isOpenLog: true,
    },
    jwtSecret: '',
    isOpenLog: true,
    db: {
      host: '127.0.0.1',
      port: '3306',
      user: 'root',
      password: '',
      database: 'nuxt4_demo',
    },
    oss: {
      region:"oss-cn-wuhan-lr",
      bucket:"nick-img-bucket-xxxxxx-from-xxx",
      accessKeyId:"",
      accessKeySecret:""
    },
    deepseek: {
      model:"deepseek-v4-flash",
      apiKey:"",
      baseUrl:""
    },
    nls: {
      accessKeyId:"",
      accessKeySecret:"",
      gateway:"nls-gateway.aliyuncs.com",
      appKey:""
    },
    aiContent: {
      appId:"",
      appSecret:"",
      accessKeyId:"",
      accessKeySecret:"",
      authUrl: "https://api.cloud.ssapi.cn/auth/authorize"
    },
    bss: {
      accessKeyId:"",
      accessKeySecret:""      
    }

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
    port: 5173
  },

  nitro: {
    externals: {
      trace: false,
    },
  },
})