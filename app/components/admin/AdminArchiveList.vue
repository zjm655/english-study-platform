<!-- app/components/admin/AdminArchiveList.vue：归档表只读浏览（P2-B）
     三张归档表共用（api_call_log_archive / cloud_service_call_log_archive / admin_operation_log_archive），
     列模板与原列表端点同构；只读，不含批量选择/清理操作。 -->
<script setup lang="ts">
import { useArchiveList } from '~/composables/admin'
import type { ArchiveLogRow } from '#shared/types/adminLogs'

const props = defineProps<{
  table: 'api_call_log_archive' | 'cloud_service_call_log_archive' | 'admin_operation_log_archive'
}>()

const { isLoading, execute } = useArchiveList()

const page = ref(1)
const pageSize = ref(20)
const total = ref(0)
const list = ref<ArchiveLogRow[]>([])

function formatDate(s: unknown) {
  if (!s) return '-'
  const d = new Date(String(s))
  if (isNaN(d.getTime())) return String(s)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function statusTagType(code: unknown) {
  const n = Number(code)
  if (!Number.isFinite(n)) return 'info'
  if (n < 400) return 'success'
  if (n < 500) return 'warning'
  return 'danger'
}

async function loadList() {
  const res = await execute({
    table: props.table,
    page: page.value,
    pageSize: pageSize.value,
  })
  if (res?.code === 200 && res.data) {
    list.value = res.data.list
    total.value = res.data.total
  }
}

function handleSizeChange() {
  page.value = 1
  loadList()
}

onMounted(() => {
  loadList()
})
</script>

<template>
  <div class="admin-archive-list">
    <el-table v-loading="isLoading" :data="list" stripe row-key="id" size="small">
      <!-- api_call_log_archive -->
      <template v-if="props.table === 'api_call_log_archive'">
        <el-table-column prop="id" label="ID" width="70" />
        <el-table-column prop="method" label="Method" width="80">
          <template #default="{ row }">{{ row.method }}</template>
        </el-table-column>
        <el-table-column prop="path" label="Path" min-width="180" show-overflow-tooltip />
        <el-table-column label="Status" width="80" align="center">
          <template #default="{ row }">
            <el-tag :type="statusTagType(row.statusCode)" size="small">{{ row.statusCode }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="业务码" width="70" align="center">
          <template #default="{ row }">
            <el-tag
              v-if="row.businessCode != null"
              :type="statusTagType(row.businessCode)"
              size="small"
            >
              {{ row.businessCode }}
            </el-tag>
            <span v-else>-</span>
          </template>
        </el-table-column>
        <el-table-column prop="requestId" label="RequestId" width="90" align="center">
          <template #default="{ row }">
            <span class="text-muted">{{ row.requestId || '-' }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="userId" label="UserId" width="80" align="center">
          <template #default="{ row }">{{ row.userId ?? '-' }}</template>
        </el-table-column>
        <el-table-column prop="errorMessage" label="Error" min-width="140" show-overflow-tooltip>
          <template #default="{ row }">
            <span class="text-muted">{{ row.errorMessage || '-' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="时间" width="165">
          <template #default="{ row }">{{ formatDate(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column label="归档时间" width="165">
          <template #default="{ row }">{{ formatDate(row.archivedAt) }}</template>
        </el-table-column>
      </template>

      <!-- cloud_service_call_log_archive -->
      <template v-else-if="props.table === 'cloud_service_call_log_archive'">
        <el-table-column prop="id" label="ID" width="70" />
        <el-table-column prop="service" label="Service" width="100">
          <template #default="{ row }">{{ row.service }}</template>
        </el-table-column>
        <el-table-column prop="operation" label="Operation" min-width="150" show-overflow-tooltip />
        <el-table-column prop="success" label="Success" width="80" align="center">
          <template #default="{ row }">
            <el-tag :type="row.success ? 'success' : 'info'" size="small">
              {{ row.success ? '是' : '否' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="requestId" label="RequestId" width="90" align="center">
          <template #default="{ row }">
            <span class="text-muted">{{ row.requestId || '-' }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="durationMs" label="Duration" width="90" align="center">
          <template #default="{ row }">{{ row.durationMs }}ms</template>
        </el-table-column>
        <el-table-column label="BizDuration" width="105" align="center">
          <template #default="{ row }">
            <span class="text-muted">{{
              row.bizDurationMs != null ? row.bizDurationMs + 'ms' : '-'
            }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="errorMessage" label="Error" min-width="140" show-overflow-tooltip>
          <template #default="{ row }">
            <span class="text-muted">{{ row.errorMessage || '-' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="时间" width="165">
          <template #default="{ row }">{{ formatDate(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column label="归档时间" width="165">
          <template #default="{ row }">{{ formatDate(row.archivedAt) }}</template>
        </el-table-column>
      </template>

      <!-- admin_operation_log_archive -->
      <template v-else>
        <el-table-column prop="id" label="ID" width="70" />
        <el-table-column prop="adminId" label="AdminId" width="90" align="center">
          <template #default="{ row }">{{ row.adminId ?? '-' }}</template>
        </el-table-column>
        <el-table-column prop="action" label="操作" width="170" />
        <el-table-column prop="targetType" label="对象类型" width="150">
          <template #default="{ row }">{{ row.targetType || '-' }}</template>
        </el-table-column>
        <el-table-column prop="targetId" label="对象ID" width="80" align="center" />
        <el-table-column label="详情" min-width="200">
          <template #default="{ row }">
            <span class="text-muted">{{ row.detail ? JSON.stringify(row.detail) : '-' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="时间" width="165">
          <template #default="{ row }">{{ formatDate(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column label="归档时间" width="165">
          <template #default="{ row }">{{ formatDate(row.archivedAt) }}</template>
        </el-table-column>
      </template>

      <template #empty>
        <el-empty description="暂无归档记录" :image-size="60" />
      </template>
    </el-table>

    <div class="pagination-row">
      <el-pagination
        v-model:current-page="page"
        v-model:page-size="pageSize"
        :total="total"
        :page-sizes="[10, 20, 50]"
        layout="total, sizes, prev, pager, next"
        background
        size="small"
        @current-change="loadList"
        @size-change="handleSizeChange"
      />
    </div>
  </div>
</template>

<style scoped>
.pagination-row {
  display: flex;
  justify-content: flex-end;
  margin-top: 12px;
}

.text-muted {
  color: var(--text-3);
}
</style>
