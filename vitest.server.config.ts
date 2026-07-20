import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

const serverDir = fileURLToPath(new URL('./server', import.meta.url))
const sharedDir = fileURLToPath(new URL('./shared', import.meta.url))

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['server/**/*.test.ts'],
  },
  resolve: {
    // 使服务端测试能解析项目别名（handler 级集成测试需真实导入 #server/utils/validate 等）
    alias: {
      '#server': serverDir,
      '#shared': sharedDir,
    },
  },
  define: {
    'import.meta.server': 'true',
    'import.meta.client': 'false',
  },
})
