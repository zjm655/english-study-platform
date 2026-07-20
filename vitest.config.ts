import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import AutoImport from 'unplugin-auto-import/vite'
import { fileURLToPath } from 'node:url'

const appDir = fileURLToPath(new URL('./app', import.meta.url))
const sharedDir = fileURLToPath(new URL('./shared', import.meta.url))

export default defineConfig({
  plugins: [
    vue(),
    AutoImport({
      imports: [
        'vue',
        {
          'vue-router': ['useRoute', 'useRouter'],
        },
      ],
      dirs: [],
    }),
  ],
  test: {
    environment: 'happy-dom',
    globals: true,
    include: ['app/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '~': appDir,
      '#shared': sharedDir,
    },
  },
  define: {
    definePageMeta: '(() => {})',
    'import.meta.client': 'true',
    'import.meta.server': 'false',
  },
})