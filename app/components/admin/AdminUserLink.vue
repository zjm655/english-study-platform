<script setup lang="ts">
/**
 * 管理后台跨页用户链接：userId 非空渲染蓝色可点击链接跳转用户详情页，
 * 为空（如上传者已注销且用户行不存在）降级为灰色纯文本，仅展示 label。
 */
const props = defineProps<{
  /** 目标用户 ID，null 时不可点击 */
  userId: number | null
  /** 展示文案（如用户名 / 「已注销用户」） */
  label: string
}>()

function goUser() {
  if (props.userId != null) navigateTo(`/admin/users/${props.userId}`)
}
</script>

<template>
  <el-link v-if="userId != null" type="primary" @click="goUser">{{ label }}</el-link>
  <span v-else class="admin-user-link--plain">{{ label }}</span>
</template>

<style scoped>
.admin-user-link--plain {
  color: var(--text-4);
}
</style>
