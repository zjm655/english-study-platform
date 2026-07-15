// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  css: ['~/assets/css/global.css'],
  runtimeConfig: {
    public: {
      isOpenLog: process.env.NUXT_PUBLIC_IS_OPEN_LOG === 'true',
    },
    jwtSecret: process.env.NUXT_JWT_SECRET || '',
    isOpenLog: process.env.NUXT_IS_OPEN_LOG === 'true',
    db: {
      host: process.env.NUXT_DB_HOST || '127.0.0.1',
      port: process.env.NUXT_DB_PORT || '3306',
      user: process.env.NUXT_DB_USER || 'root',
      password: process.env.NUXT_DB_PASSWORD || '',
      database: process.env.NUXT_DB_DATABASE || 'nuxt4_demo',
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
})