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
            <el-tag :type="roleTag(detail.user.role).type" size="small">
              {{ roleTag(detail.user.role).text }}
            </el-tag>
            <el-tag type="primary" size="small">{{ levelText(detail.user.level) }}</el-tag>
            <el-tag
              :type="
                detail.user.deletedAt !== null
                  ? 'info'
                  : detail.user.status === 0
                    ? 'danger'
                    : 'success'
              "
              size="small"
            >
              {{
                detail.user.deletedAt !== null
                  ? '已注销'
                  : detail.user.status === 0
                    ? '封禁'
                    : '正常'
              }}
            </el-tag>
          </div>
        </div>
        <div class="info-meta">
          <span>邮箱: {{ detail.user.email || '-' }}</span>
          <span>注册时间: {{ formatDate(detail.user.createdAt) }}</span>
          <span v-if="detail.user.deletedAt"
            >注销时间: {{ formatDate(detail.user.deletedAt) }}</span
          >
        </div>
        <!-- 授权管理（超管专属）：角色 + 细粒度权限，即时生效并记入操作日志 -->
        <div v-if="isSuperAdmin && detail.user.deletedAt === null" class="grant-section">
          <div class="grant-row">
            <span class="grant-label">角色</span>
            <!-- 唯一超管受保护（不可降权/不可新增）：该目标即查看者自身，以只读标签代替 radio -->
            <template v-if="detail.user.role === ROLE_SUPER_ADMIN">
              <el-tag type="danger" size="small">超级管理员（受保护，不可变更）</el-tag>
            </template>
            <template v-else>
              <el-radio-group v-model="editRole" :disabled="isSelf">
                <el-radio :value="ROLE_USER">普通用户</el-radio>
                <el-radio :value="ROLE_ADMIN">管理员</el-radio>
              </el-radio-group>
              <el-button
                type="primary"
                size="small"
                :loading="isRoleChanging"
                :disabled="isSelf || editRole === detail.user.role"
                @click="handleSaveRole"
              >
                保存角色
              </el-button>
            </template>
          </div>
          <div class="grant-row grant-row--perms">
            <span class="grant-label">权限（对管理员生效；超管隐式全权）</span>
            <el-checkbox-group
              v-model="editPermissions"
              :disabled="isSelf || detail.user.role !== ROLE_ADMIN"
            >
              <el-checkbox v-for="key in GRANTABLE_PERMISSIONS" :key="key" :value="key">
                {{ PERMISSION_LABELS[key] }}
              </el-checkbox>
            </el-checkbox-group>
            <el-button
              type="primary"
              size="small"
              :loading="isPermSaving"
              :disabled="isSelf"
              @click="handleSavePermissions"
            >
              保存权限
            </el-button>
          </div>
          <p v-if="isSelf" class="grant-tip">不能修改自己的角色与权限</p>
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
          <div class="metric-value">
            {{ detail.stats.avgScore != null ? Number(detail.stats.avgScore).toFixed(1) : '-' }}
          </div>
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
        <el-empty
          v-if="detail.unitProgress.length === 0"
          description="暂无学习数据"
          :image-size="60"
        />
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
                  <el-tag :type="seg.phase1Done ? 'success' : 'info'" size="small" effect="plain"
                    >盲听</el-tag
                  >
                  <el-tag :type="seg.phase2Done ? 'success' : 'info'" size="small" effect="plain"
                    >学习</el-tag
                  >
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
            <template #default="{ row }">{{
              row.duration != null ? formatDuration(row.duration) : '-'
            }}</template>
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
              size="small"
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
import {
  useAdminUserDetail,
  useUpdateAdminUserRole,
  useAdminUserLogs,
  useAdminUserPermissions,
  useUpdateAdminUserPermissions,
} from '~/composables/admin'
import { usePermission } from '~/composables/user'
import { useUserStore } from '~/store/useUserStore'
import { toastConfirm, toastSuccess } from '~/utils/popup'
import { ROLE_ADMIN, ROLE_USER, ROLE_SUPER_ADMIN } from '#shared/utils/role'
import { GRANTABLE_PERMISSIONS, PERMISSION_LABELS } from '#shared/utils/permission'
import type { PermissionKey } from '#shared/utils/permission'
import type { AdminUserDetail } from '#shared/types/adminUser'
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
const { execute: permExecute } = useAdminUserPermissions()
const { isLoading: isPermSaving, execute: permSaveExecute } = useUpdateAdminUserPermissions()

const { isSuperAdmin } = usePermission()
const userStore = useUserStore()
const isSelf = computed(() => userStore.user?.id === userId)

const detail = ref<AdminUserDetail | null>(null)
const editRole = ref<number>(ROLE_USER)
const editPermissions = ref<PermissionKey[]>([])
const logs = ref<AdminOperationLogItem[]>([])
const logsPage = ref(1)
const logsPageSize = ref(10)
const logsTotal = ref(0)

async function loadDetail() {
  const res = await detailExecute(userId)
  if (res?.code === 200 && res.data) {
    detail.value = res.data
    editRole.value = res.data.user.role
  }
}

// 授权数据（超管专属）：加载目标用户当前权限键
async function loadPermissions() {
  const res = await permExecute(userId)
  if (res?.code === 200 && res.data) {
    editPermissions.value = res.data.permissions as PermissionKey[]
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

async function handleSaveRole() {
  if (!detail.value) return
  const roleName =
    editRole.value === ROLE_SUPER_ADMIN
      ? '超级管理员'
      : editRole.value === ROLE_ADMIN
        ? '管理员'
        : '普通用户'
  try {
    await toastConfirm(
      `确定将该用户角色变更为「${roleName}」吗？将即时生效并记入操作日志。`,
      '角色变更确认',
      { confirmButtonText: '确定', cancelButtonText: '取消', type: 'warning' },
    )
  } catch {
    return
  }
  const res = await roleExecute({ id: userId, role: editRole.value })
  if (res?.code === 200) {
    toastSuccess('角色已更新')
    loadDetail()
  }
}

async function handleSavePermissions() {
  const res = await permSaveExecute({ id: userId, permissions: editPermissions.value })
  if (res?.code === 200) {
    toastSuccess('权限已更新')
  }
}

function levelText(level: number) {
  return ['未测试', '初级', '中级', '高级'][level] ?? '未测试'
}

function roleTag(role: number) {
  if (role >= ROLE_SUPER_ADMIN) return { type: 'danger' as const, text: '超级管理员' }
  if (role === ROLE_ADMIN) return { type: 'warning' as const, text: '管理员' }
  return { type: 'info' as const, text: '普通用户' }
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
  if (isSuperAdmin.value) loadPermissions()
})
</script>

<style scoped>
.user-detail-page {
  width: 100%;
  /* max-width: 960px; */
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

.grant-section {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px dashed var(--border-ll);
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.grant-row {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.grant-row--perms {
  align-items: flex-start;
}

.grant-label {
  font-size: 13px;
  color: var(--text-2);
  min-width: 72px;
}

.grant-tip {
  font-size: 12px;
  color: var(--text-3);
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
