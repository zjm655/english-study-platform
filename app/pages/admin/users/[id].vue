<template>
  <div class="user-detail-page">
    <div class="page-header">
      <div>
        <h2 class="page-title">用户详情</h2>
        <p class="page-desc">查看用户学习数据与操作记录</p>
      </div>
      <el-button @click="navigateTo('/admin/users')">返回列表</el-button>
    </div>

    <!-- 加载中 -->
    <el-skeleton v-if="isLoading" :rows="8" animated />

    <template v-else-if="detail">
      <!-- 已注销横幅 -->
      <el-alert
        v-if="detail.user.deletedAt !== null"
        title="该用户已注销，数据仅保留供查阅"
        type="info"
        show-icon
        :closable="false"
        class="alert-banner"
      />

      <!-- 封禁警告 -->
      <el-alert
        v-else-if="detail.user.status === 0"
        title="该用户已被封禁"
        type="warning"
        show-icon
        :closable="false"
        class="alert-banner"
      />

      <!-- 用户信息卡 -->
      <el-card class="info-card" shadow="never">
        <div class="info-row">
          <div class="info-main">
            <span class="info-nickname">{{ detail.user.nickname || detail.user.account }}</span>
            <span class="info-account">账号: {{ detail.user.account }}</span>
          </div>
          <div class="info-tags">
            <el-tag :type="detail.user.role === 1 ? 'warning' : 'info'" size="small">
              {{ detail.user.role === 1 ? '管理员' : '普通用户' }}
            </el-tag>
            <el-tag type="primary" size="small">{{ levelText(detail.user.level) }}</el-tag>
            <el-tag
              :type="detail.user.deletedAt !== null ? 'info' : detail.user.status === 0 ? 'danger' : 'success'"
              size="small"
            >
              {{ detail.user.deletedAt !== null ? '已注销' : detail.user.status === 0 ? '封禁' : '正常' }}
            </el-tag>
          </div>
        </div>
        <div class="info-meta">
          <span>邮箱: {{ detail.user.email || '-' }}</span>
          <span>注册时间: {{ formatDate(detail.user.createdAt) }}</span>
          <span v-if="detail.user.deletedAt">注销时间: {{ formatDate(detail.user.deletedAt) }}</span>
        </div>
        <!-- 角色操作 -->
        <div class="info-actions" v-if="detail.user.deletedAt === null">
          <el-button
            v-if="detail.user.role === 0"
            type="warning"
            size="small"
            :loading="isRoleChanging"
            @click="handlePromote"
          >
            提升为管理员
          </el-button>
          <el-button
            v-else
            type="danger"
            size="small"
            :loading="isRoleChanging"
            @click="handleDemote"
          >
            降级为普通用户
          </el-button>
        </div>
      </el-card>

      <!-- 学习统计指标带 -->
      <div class="metric-band">
        <div class="metric-item">
          <div class="metric-value">{{ detail.stats.totalSegmentsCompleted }}</div>
          <div class="metric-label">已完成片段</div>
        </div>
        <div class="metric-item">
          <div class="metric-value">{{ detail.stats.totalRecordings }}</div>
          <div class="metric-label">录音总数</div>
        </div>
        <div class="metric-item">
          <div class="metric-value">{{ detail.stats.avgScore != null ? detail.stats.avgScore.toFixed(1) : '-' }}</div>
          <div class="metric-label">配音平均分</div>
        </div>
        <div class="metric-item">
          <div class="metric-value">{{ formatDuration(detail.stats.totalStudySeconds) }}</div>
          <div class="metric-label">学习时长</div>
        </div>
        <div class="metric-item">
          <div class="metric-value">{{ detail.stats.totalCheckinDays }}</div>
          <div class="metric-label">打卡天数</div>
        </div>
        <div class="metric-item">
          <div class="metric-value">{{ detail.stats.currentStreak }}</div>
          <div class="metric-label">连续天数</div>
        </div>
      </div>

      <!-- Unit 进度 -->
      <div class="section">
        <h3 class="section-title">学习进度</h3>
        <el-empty v-if="detail.unitProgress.length === 0" description="暂无学习数据" :image-size="60" />
        <template v-else>
          <el-card
            v-for="unit in detail.unitProgress"
            :key="unit.unitId"
            class="unit-card"
            shadow="never"
          >
            <template #header>
              <span class="unit-title">Unit: {{ unit.unitTitle }}</span>
            </template>
            <div class="segment-list">
              <div v-for="seg in unit.segments" :key="seg.segmentId" class="segment-row">
                <span class="segment-name">{{ seg.segmentTitle }}</span>
                <span class="segment-phases">
                  <el-tag :type="seg.phase1Done ? 'success' : 'info'" size="small" effect="plain">盲听</el-tag>
                  <el-tag :type="seg.phase2Done ? 'success' : 'info'" size="small" effect="plain">学习</el-tag>
                  <el-tag :type="seg.phase3Done ? 'success' : 'info'" size="small" effect="plain">
                    配音 {{ seg.phase3Score != null ? seg.phase3Score : '' }}
                  </el-tag>
                  <el-tag :type="seg.phase4Done ? 'success' : 'info'" size="small" effect="plain">
                    跟读 {{ seg.phase4Score != null ? seg.phase4Score : '' }}
                  </el-tag>
                </span>
              </div>
            </div>
          </el-card>
        </template>
      </div>

      <!-- 录音历史 -->
      <div class="section">
        <h3 class="section-title">录音记录（最近 20 条）</h3>
        <el-empty
          v-if="detail.recentRecordings.length === 0"
          description="暂无录音记录"
          :image-size="60"
        />
        <el-table v-else :data="detail.recentRecordings" stripe row-key="id" size="small">
          <el-table-column type="index" width="50" label="#" />
          <el-table-column prop="segmentTitle" label="片段" min-width="150" show-overflow-tooltip />
          <el-table-column label="阶段" width="80" align="center">
            <template #default="{ row }">{{ row.phase === 3 ? '配音' : '跟读' }}</template>
          </el-table-column>
          <el-table-column label="得分" width="80" align="center">
            <template #default="{ row }">{{ row.score != null ? row.score : '-' }}</template>
          </el-table-column>
          <el-table-column label="时长" width="90" align="center">
            <template #default="{ row }">{{ row.duration != null ? formatDuration(row.duration) : '-' }}</template>
          </el-table-column>
          <el-table-column label="时间" width="170">
            <template #default="{ row }">{{ formatDate(row.createdAt) }}</template>
          </el-table-column>
        </el-table>
      </div>

      <!-- 操作日志 -->
      <div class="section">
        <h3 class="section-title">操作日志</h3>
        <el-empty
          v-if="logs.length === 0 && !logsLoading"
          description="暂无操作记录"
          :image-size="60"
        />
        <template v-else>
          <el-table v-loading="logsLoading" :data="logs" stripe row-key="id" size="small">
            <el-table-column prop="id" label="ID" width="70" />
            <el-table-column prop="adminAccount" label="管理员" width="120">
              <template #default="{ row }">{{ row.adminAccount || '已删除' }}</template>
            </el-table-column>
            <el-table-column prop="action" label="操作" width="160" />
            <el-table-column label="详情" min-width="200">
              <template #default="{ row }">
                <template v-if="row.detail">
                  <el-popover placement="left" :width="300" trigger="click">
                    <template #reference>
                      <el-button link type="primary" size="small">查看详情</el-button>
                    </template>
                    <pre class="json-detail">{{ JSON.stringify(row.detail, null, 2) }}</pre>
                  </el-popover>
                </template>
                <span v-else>-</span>
              </template>
            </el-table-column>
            <el-table-column label="时间" width="170">
              <template #default="{ row }">{{ formatDate(row.createdAt) }}</template>
            </el-table-column>
          </el-table>
          <div class="pagination-row">
            <el-pagination
              v-model:current-page="logsPage"
              :page-size="logsPageSize"
              :total="logsTotal"
              layout="prev, pager, next"
              background
              small
              @current-change="loadLogs"
            />
          </div>
        </template>
      </div>
    </template>

    <!-- 加载失败 -->
    <el-empty v-else description="加载失败" :image-size="80" />
  </div>
</template>

<script setup lang="ts">
import { useAdminUserDetail, useUpdateAdminUserRole, useAdminUserLogs } from '~/composables/admin'
import { toastConfirm, toastSuccess } from '~/utils/popup'
import type { AdminUserDetail, AdminUserRecordingItem } from '#shared/types/adminUser'
import type { AdminOperationLogItem } from '#shared/types/adminOperationLog'

definePageMeta({
  layout: 'admin',
  title: '用户详情',
})

useSeoMeta({ title: '用户详情 - 管理后台' })

const route = useRoute()
const userId = Number(route.params.id)

const { isLoading, execute: detailExecute } = useAdminUserDetail()
const { isLoading: isRoleChanging, execute: roleExecute } = useUpdateAdminUserRole()
const { isLoading: logsLoading, execute: logsExecute } = useAdminUserLogs()

const detail = ref<AdminUserDetail | null>(null)
const logs = ref<AdminOperationLogItem[]>([])
const logsPage = ref(1)
const logsPageSize = ref(10)
const logsTotal = ref(0)

async function loadDetail() {
  const res = await detailExecute(userId)
  if (res?.code === 200 && res.data) {
    detail.value = res.data
  }
}

async function loadLogs() {
  const res = await logsExecute({
    id: userId,
    query: { page: logsPage.value, pageSize: logsPageSize.value },
  })
  if (res?.code === 200 && res.data) {
    logs.value = res.data.list
    logsTotal.value = res.data.total
  }
}

async function handlePromote() {
  try {
    await toastConfirm('确定将该用户提升为管理员吗？提升后该用户将获得后台管理权限。', '提升确认', {
      confirmButtonText: '提升',
      cancelButtonText: '取消',
      type: 'warning',
    })
  } catch {
    return
  }
  const res = await roleExecute({ id: userId, role: 1 })
  if (res?.code === 200) {
    toastSuccess('已提升为管理员')
    loadDetail()
  }
}

async function handleDemote() {
  try {
    await toastConfirm(
      '确定将该管理员降级为普通用户吗？降级后该用户将失去所有后台管理权限。',
      '降权确认',
      {
        confirmButtonText: '降级',
        cancelButtonText: '取消',
        type: 'warning',
      },
    )
  } catch {
    return
  }
  const res = await roleExecute({ id: userId, role: 0 })
  if (res?.code === 200) {
    toastSuccess('已降级为普通用户')
    loadDetail()
  }
}

function levelText(level: number) {
  return ['未测试', '初级', '中级', '高级'][level] ?? '未测试'
}

function formatDate(s: string) {
  if (!s) return '-'
  const d = new Date(s)
  if (isNaN(d.getTime())) return s
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function formatDuration(seconds: number | null) {
  if (seconds == null) return '00:00'
  const totalSec = Math.round(seconds)
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

onMounted(() => {
  loadDetail()
  loadLogs()
})
</script>

<style scoped>
.user-detail-page {
  width: 100%;
  max-width: 960px;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 20px;
}

.page-title {
  font-size: 22px;
  font-weight: 700;
  color: var(--text-1);
  margin-bottom: 6px;
}

.page-desc {
  font-size: 14px;
  color: var(--text-3);
}

.alert-banner {
  margin-bottom: 16px;
}

/* 用户信息卡 */
.info-card {
  margin-bottom: 20px;
}

.info-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}

.info-main {
  display: flex;
  align-items: baseline;
  gap: 12px;
}

.info-nickname {
  font-size: 18px;
  font-weight: 600;
  color: var(--text-1);
}

.info-account {
  font-size: 14px;
  color: var(--text-2);
}

.info-tags {
  display: flex;
  gap: 6px;
}

.info-meta {
  display: flex;
  gap: 24px;
  font-size: 14px;
  color: var(--text-2);
}

.info-actions {
  margin-top: 12px;
}

/* 指标带 */
.metric-band {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 12px;
  margin-bottom: 24px;
}

.metric-item {
  background: var(--card);
  border: 1px solid var(--border-ll);
  border-radius: 8px;
  padding: 16px 12px;
  text-align: center;
}

.metric-value {
  font-size: 24px;
  font-weight: 700;
  color: var(--primary);
  margin-bottom: 4px;
}

.metric-label {
  font-size: 12px;
  color: var(--text-3);
}

/* Section */
.section {
  margin-bottom: 24px;
}

.section-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-1);
  margin-bottom: 12px;
}

/* Unit 进度 */
.unit-card {
  margin-bottom: 12px;
}

.unit-card:last-child {
  margin-bottom: 0;
}

.unit-title {
  font-weight: 600;
  font-size: 15px;
}

.segment-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.segment-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 0;
  border-bottom: 1px solid var(--border-el);
}

.segment-row:last-child {
  border-bottom: none;
}

.segment-name {
  font-size: 14px;
  color: var(--text-1);
  flex: 1;
}

.segment-phases {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}

/* 操作日志 */
.pagination-row {
  display: flex;
  justify-content: flex-end;
  margin-top: 12px;
}

.json-detail {
  font-size: 12px;
  color: var(--text-2);
  margin: 0;
  white-space: pre-wrap;
  word-break: break-all;
}
</style>
