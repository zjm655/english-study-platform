import { createConfigForNuxt } from '@nuxt/eslint-config/flat'
import prettierConfig from 'eslint-config-prettier'

export default createConfigForNuxt({
  // Nuxt 项目自动识别 auto-imports、别名等
})
  .prepend({
    ignores: ['node_modules/', '.nuxt/', '.output/', 'dist/', 'public/sdk/', 'content/', 'logs/**'],
  })
  .append({
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      'vue/multi-word-component-names': 'off',
      'vue/no-v-html': 'warn',
    },
  })
  // 前端类型单一路径防线：请求参数类型统一从 #shared/types/* 读取（推导自 shared/schemas/），
  // 禁止直接导入 #shared/schemas/* 或 zod（含 import type），避免类型来源分叉与 zod 进客户端 bundle
  .append({
    files: ['app/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '^#shared/schemas/',
              message:
                '前端请从 #shared/types/* 读取共享类型，禁止直接导入 #shared/schemas/*（类型来源分叉）。',
            },
            {
              regex: '^zod($|/)',
              message:
                '前端禁止导入 zod（含 import type），类型由 #shared/types/* 推导提供，避免 zod 运行时进入客户端 bundle。',
            },
          ],
        },
      ],
    },
  })
  .append(prettierConfig)
