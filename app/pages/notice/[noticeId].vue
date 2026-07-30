<template>
  <div class="notice-detail-page">
    <div v-loading="isLoading" class="notice-detail-body">
      <!-- 详情 -->
      <div v-if="detail" class="notice-detail-card">
        <div class="notice-detail__title-row">
          <el-tag v-if="detail.isPinned" type="warning" size="small">置顶</el-tag>
          <h2 class="notice-detail__title">{{ detail.title }}</h2>
        </div>
        <div class="notice-detail__time">发布于 {{ formatDateTime(detail.publishAt) }}</div>
        <div class="notice-detail__content">{{ detail.content }}</div>
      </div>

      <!-- 错误空态：404 与其他错误文案区分 -->
      <el-empty v-else-if="!isLoading" :description="errorText" />
    </div>

    <div class="notice-detail__back">
      <el-button @click="navigateTo('/notice')">返回列表</el-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useNoticeDetail } from '~/composables/notice'
import type { NoticeDetail } from '#shared/types/notice'

definePageMeta({
  title: '公告详情',
})

useSeoMeta({
  title: '公告详情',
  description: '查看系统公告详情。',
  // 登录态私有页面，不让搜索引擎收录
  robots: 'noindex, nofollow',
})

const route = useRoute()
const detail = ref<NoticeDetail | null>(null)
// 错误空态文案：非法 ID / 404 显示默认文案，其他错误展示后端 message 或通用重试提示
const errorText = ref('公告不存在或已下线')

const { isLoading, execute: detailExecute } = useNoticeDetail()

// GET 详情即后端自动标已读，无需前端再调标已读接口
async function loadDetail() {
  const noticeId = Number(route.params.noticeId)
  // 非法 ID 直接落空态，不发请求
  if (!noticeId || isNaN(noticeId)) return
  const res = await detailExecute(noticeId)
  if (res?.code === 200 && res.data) {
    detail.value = res.data
  } else if (res && res.code !== 404) {
    // 非 404 错误：业务错误码优先展示后端 message，网络异常（code<=0）用通用重试文案
    errorText.value = res.code > 0 && res.message ? res.message : '加载失败，请稍后重试'
  }
}

function formatDateTime(s: string) {
  if (!s) return '-'
  const d = new Date(s)
  if (isNaN(d.getTime())) return s
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

onMounted(() => {
  loadDetail()
})
</script>

<style scoped>
.notice-detail-page {
  padding: 16px;
  min-height: 100%;
}

.notice-detail-body {
  min-height: 120px;
}

.notice-detail-card {
  background: var(--card);
  border-radius: var(--r-xl);
  padding: 20px 16px;
  box-shadow: var(--shadow);
}

.notice-detail__title-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.notice-detail__title {
  font-size: 18px;
  font-weight: 700;
  color: var(--text-1);
  line-height: 1.4;
}

.notice-detail__time {
  margin-top: 8px;
  font-size: 12px;
  color: var(--text-3);
}

.notice-detail__content {
  margin-top: 16px;
  font-size: 15px;
  line-height: 1.8;
  color: var(--text-2);
  /* 保留公告正文换行，长英文/链接强制断行防溢出 */
  white-space: pre-wrap;
  word-break: break-word;
}

.notice-detail__back {
  margin-top: 20px;
}

.notice-detail__back .el-button {
  width: 100%;
}
</style>
