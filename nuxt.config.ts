// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: process.env.NODE_ENV === 'development' },
  css: ['~/assets/css/global.css'],
  app: {
    head: {
      script: [
        // require polyfill：engine.js 是 Emscripten 打包的 Node 目标包，
        // 内部有 require("path")，浏览器没有 require，需要在 engine.js 之前注入
        {
          innerHTML: `
            window.require = window.require || function(name) {
              var polyfills = {
                'path': {
                  normalize: function(p) { return p || '' },
                  resolve: function() { return Array.prototype.slice.call(arguments).join('/') || '/' },
                  dirname: function(p) { var parts = (p || '').split('/'); parts.pop(); return parts.join('/') || '.' },
                  basename: function(p) { return (p || '').split('/').pop() || '' },
                  join: function() { return Array.prototype.slice.call(arguments).join('/') },
                  sep: '/',
                  delimiter: ':'
                }
              };
              return polyfills[name] || {};
            };
          `,
          tagPosition: 'head'
        }
      ]
    }
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
    eval: {
      appId: '',
      appSecret: '',
      gateway: '',
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
    port: 5173
  },

  nitro: {
    externals: {
      trace: false,
    },
  },
})