import { createConfigForNuxt } from '@nuxt/eslint-config/flat'
import prettierConfig from 'eslint-config-prettier'

export default createConfigForNuxt({
  // Nuxt 项目自动识别 auto-imports、别名等
})
  .prepend({
    ignores: ['node_modules/', '.nuxt/', '.output/', 'dist/', 'public/sdk/', 'content/', 'logs/'],
  })
  .append({
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      'vue/multi-word-component-names': 'off',
      'vue/no-v-html': 'warn',
    },
  })
  .append(prettierConfig)
