<template>
  <div class="graphic-captcha">
    <el-input
      v-model="code"
      :placeholder="placeholder"
      class="graphic-captcha__input"
      maxlength="6"
    />
    <button
      type="button"
      class="graphic-captcha__img"
      title="点击刷新验证码"
      :disabled="isLoading"
      @click="refresh"
    >
      <img v-if="svgDataUri" :src="svgDataUri" alt="验证码" />
      <span v-else class="graphic-captcha__loading">…</span>
    </button>
  </div>
</template>

<script setup lang="ts">
import { useCaptcha } from '~/composables/user'

withDefaults(defineProps<{ placeholder?: string }>(), {
  placeholder: '请输入验证码',
})

// 双向绑定：token 由服务端下发，code 为用户输入；父组件用 v-model:token / v-model:code 接收
const token = defineModel<string>('token', { default: '' })
const code = defineModel<string>('code', { default: '' })

const svg = ref('')
const { isLoading, execute } = useCaptcha()

// 以 <img> data URI 渲染 SVG：避免 v-html，SVG 经 img 加载不执行脚本，无 XSS 面
const svgDataUri = computed(() =>
  svg.value ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.value)}` : '',
)

/** 拉取新验证码：清空旧输入 + 刷新图与 token（静默，避免刷屏日志） */
async function refresh() {
  code.value = ''
  const res = await execute(null, { silent: true })
  if (res.code === 200 && res.data) {
    svg.value = res.data.svg
    token.value = res.data.token
  }
}

onMounted(refresh)
// 暴露 refresh 给父组件（如后端返回验证码错误时主动刷新）
defineExpose({ refresh })
</script>

<style scoped>
.graphic-captcha {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
}
.graphic-captcha__input {
  flex: 1;
}
.graphic-captcha__img {
  flex-shrink: 0;
  width: 120px;
  height: 40px;
  padding: 0;
  border: 1px solid var(--el-border-color, #dcdfe6);
  border-radius: 4px;
  background: #f2f3f5;
  cursor: pointer;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
}
.graphic-captcha__img:hover {
  border-color: var(--el-color-primary, #409eff);
}
.graphic-captcha__img img {
  display: block;
  width: 100%;
  height: 100%;
}
.graphic-captcha__loading {
  font-size: 12px;
  color: var(--el-text-color-secondary, #909399);
}
</style>
