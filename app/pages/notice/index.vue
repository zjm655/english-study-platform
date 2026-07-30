<template>
  <div class="notice-page">
    <!-- 顶部工具行：全部已读（无未读时隐藏） -->
    <div v-if="unreadCount > 0" class="notice-toolbar">
      <el-button type="primary" link :loading="isReadingAll" @click="handleReadAll">
        全部已读
      </el-button>
    </div>

    <!-- 列表 -->
    <div v-loading="isLoading" class="notice-list">
      <div
        v-for="item in list"
        :key="item.id"
        class="notice-card"
        @click="navigateTo(`/notice/${item.id}`)"
      >
        <span v-if="!item.isRead" class="notice-card__dot"></span>
        <div class="notice-card__main">
          <div class="notice-card__title-row">
            <el-tag v-if="item.isPinned" type="warning" size="small" class="notice-card__pin"
              >置顶</el-tag
            >
            <span
              class="notice-card__title"
              :class="{ 'notice-card__title--unread': !item.isRead }"
            >
              {{ item.title }}
            </span>
          </div>
          <div class="notice-card__time">{{ formatRelativeTime(item.publishAt) }}</div>
        </div>
        <span v-if="item.isRead" class="notice-card__read">已读</span>
      </div>

      <!-- 空态 -->
      <el-empty v-if="!isLoading && list.length === 0" description="暂无消息" />
    </div>

    <!-- 分页（移动端简洁布局） -->
    <div v-if="total > pageSize" class="notice-pagination">
      <el-pagination
        v-model:current-page="page"
        :page-size="pageSize"
        :total="total"
        layout="prev, pager, next"
        background
        @current-change="loadList"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { useNoticeList, useNoticeUnread, useNoticeReadAll } from '~/composables/notice'
import type { NoticeListItem } from '#shared/types/notice'

definePageMeta({
  title: '消息中心',
})

useSeoMeta({
  title: '消息中心',
  description: '查看系统公告与最新消息。',
  // 登录态私有页面，不让搜索引擎收录
  robots: 'noindex, nofollow',
})

// 分页
const page = ref(1)
const pageSize = ref(10)
const total = ref(0)
const list = ref<NoticeListItem[]>([])

const { isLoading, execute: listExecute } = useNoticeList()
const { unreadCount, refresh: refreshUnread } = useNoticeUnread()
const { isLoading: isReadingAll, execute: readAllExecute } = useNoticeReadAll()

async function loadList() {
  const res = await listExecute({ page: page.value, pageSize: pageSize.value })
  if (res?.code === 200 && res.data) {
    list.value = res.data.list
    total.value = res.data.total
  }
}

// 全部已读：成功后刷新列表与未读数（按钮随 unreadCount 归零自动隐藏）
async function handleReadAll() {
  const res = await readAllExecute(null)
  if (res?.code === 200) {
    loadList()
    refreshUnread()
  }
}

/** 相对时间：刚刚 / N分钟前 / N小时前 / N天前 / 具体日期 */
function formatRelativeTime(s: string) {
  if (!s) return '-'
  const d = new Date(s)
  if (isNaN(d.getTime())) return s
  const diff = Date.now() - d.getTime()
  if (diff < 60 * 1000) return '刚刚'
  if (diff < 60 * 60 * 1000) return `${Math.floor(diff / (60 * 1000))}分钟前`
  if (diff < 24 * 60 * 60 * 1000) return `${Math.floor(diff / (60 * 60 * 1000))}小时前`
  if (diff < 7 * 24 * 60 * 60 * 1000) return `${Math.floor(diff / (24 * 60 * 60 * 1000))}天前`
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// 严格客户端拉取：onMounted 后才发请求（本页经全局守卫，进入即登录态）
onMounted(() => {
  loadList()
  refreshUnread()
})
</script>

<style scoped>
.notice-page {
  padding: 16px;
  min-height: 100%;
}

.notice-toolbar {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 8px;
}

.notice-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 120px;
}

.notice-card {
  display: flex;
  align-items: center;
  gap: 10px;
  background: var(--card);
  border-radius: var(--r-xl);
  padding: 14px 16px;
  box-shadow: var(--shadow);
  cursor: pointer;
  transition: background 0.2s;
  -webkit-tap-highlight-color: transparent;
}

.notice-card:active {
  background: var(--border-ll);
}

/* 未读红点 */
.notice-card__dot {
  flex-shrink: 0;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--danger);
}

.notice-card__main {
  flex: 1;
  min-width: 0;
}

.notice-card__title-row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.notice-card__pin {
  flex-shrink: 0;
}

.notice-card__title {
  font-size: 15px;
  /* 默认即已读态：灰字 + 常规字重，未读由 --unread 修饰类提亮 */
  color: var(--text-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.notice-card__title--unread {
  color: var(--text-1);
  font-weight: 700;
}

.notice-card__time {
  margin-top: 4px;
  font-size: 12px;
  color: var(--text-3);
}

.notice-card__read {
  flex-shrink: 0;
  font-size: 12px;
  color: var(--text-4);
}

.notice-pagination {
  display: flex;
  justify-content: center;
  margin-top: 20px;
}
</style>
