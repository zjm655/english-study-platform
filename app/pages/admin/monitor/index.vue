<!-- app/pages/admin/monitor/index.vue：运行监控（基础设施健康 + 进程内实时快照） -->
<template>
  <div class="monitor-page">
    <!-- 页头：标题 + 实时刷新指示 + 手动刷新 -->
    <div class="page-header">
      <div>
        <h2 class="page-title">运行监控</h2>
        <p class="page-desc">
          <span class="live-dot" aria-hidden="true"></span>
          基础设施健康 + 进程内实时快照 · 每 5 秒自动刷新
        </p>
      </div>
      <div class="header-actions">
        <span v-if="snapshot" class="snapshot-time">
          快照时间 {{ formatTime(snapshot.serverTime) }}
        </span>
        <el-tooltip content="立即刷新" placement="top">
          <el-button :icon="Refresh" circle :loading="isLoading" @click="reset" />
        </el-tooltip>
      </div>
    </div>

    <!-- Redis 状态（随 5s 主轮询刷新） -->
    <section class="panel">
      <header class="panel-head">
        <h3 class="panel-title">Redis 状态</h3>
        <div class="header-actions">
          <span class="panel-sub">随主轮询刷新</span>
          <el-tooltip v-if="canBackup" content="触发 BGSAVE 生成 RDB 备份文件" placement="top">
            <el-button
              size="small"
              type="primary"
              plain
              :loading="backupIsLoading"
              :disabled="snapshot?.redis.online !== true"
              @click="handleTriggerBackup"
            >
              触发 RDB 备份
            </el-button>
          </el-tooltip>
        </div>
      </header>

      <!-- Redis 离线（未配置 / 断连回落内存态） -->
      <div v-if="snapshot && !snapshot.redis.online" class="redis-offline">
        <el-tag type="warning" size="small">Redis 不可用</el-tag>
        <span class="redis-offline-text">
          {{
            snapshot.redis.configured ? 'Redis 不可用（已回落内存态）' : '未配置 NUXT_REDIS_HOST'
          }}
        </span>
      </div>

      <!-- Redis 在线 -->
      <template v-else-if="snapshot?.redis.online">
        <div class="stat-row redis-stats">
          <div class="stat-cell">
            <span class="stat-label">版本</span>
            <span class="stat-value stat-value--sm">{{ snapshot.redis.info?.version ?? '-' }}</span>
          </div>
          <div class="stat-cell">
            <span class="stat-label">占用内存</span>
            <span class="stat-value stat-value--sm">
              {{ formatBytes(snapshot.redis.info?.usedMemoryBytes) }}
            </span>
          </div>
          <div class="stat-cell">
            <span class="stat-label">内存上限</span>
            <span class="stat-value stat-value--sm">{{ redisMaxMemoryText }}</span>
          </div>
          <div class="stat-cell">
            <span class="stat-label">连接数</span>
            <span class="stat-value stat-value--sm">
              {{ snapshot.redis.info?.connectedClients ?? '-' }}
            </span>
          </div>
          <div class="stat-cell">
            <span class="stat-label">上次 RDB</span>
            <span class="stat-value stat-value--sm">
              {{ formatAgo(snapshot.redis.info?.rdbLastBgsaveAgoSec) }}
            </span>
          </div>
          <div class="stat-cell">
            <span class="stat-label">RDB 写入中</span>
            <el-tag v-if="snapshot.redis.info?.rdbBgsaveInProgress" type="warning" size="small">
              进行中
            </el-tag>
            <span v-else class="stat-value stat-value--sm">否</span>
          </div>
        </div>

        <!-- RDB 备份结果 -->
        <div v-if="backupResult || backupError" class="backup-line">
          <template v-if="backupResult">
            <span class="num-success">已触发备份</span>
            <span>上次 RDB {{ formatAgo(backupResult.lastSaveAgoSec) }}</span>
            <el-tag :type="backupResult.inProgress ? 'warning' : 'success'" size="small">
              {{ backupResult.inProgress ? '写入中' : '空闲' }}
            </el-tag>
            <span>
              RDB 文件
              {{
                backupResult.rdbSizeBytes === null ? '未知' : formatBytes(backupResult.rdbSizeBytes)
              }}
            </span>
          </template>
          <span v-if="backupError" class="num-danger">{{ backupError }}</span>
        </div>

        <!-- key 域分布 -->
        <div v-if="redisDomainsRows.length" class="redis-domains">
          <p class="redis-domains-title">key 域分布（cfg / rl / fail / q / evt / lock / sem 等）</p>
          <el-table :data="redisDomainsRows" size="small" :border="false">
            <el-table-column label="域" prop="name" width="160" />
            <el-table-column label="key 数" prop="keys" width="140" />
            <el-table-column label="将过期（TTL&gt;0）" prop="expiring" width="180" />
            <el-table-column label="无 TTL" prop="noTtl" width="140" />
          </el-table>
        </div>
      </template>
    </section>

    <!-- MySQL 状态（30s 独立低频轮询，不随 5s 主轮询放大） -->
    <section class="panel">
      <header class="panel-head">
        <h3 class="panel-title">MySQL 状态</h3>
        <div class="header-actions">
          <span class="panel-sub">30 秒自动刷新</span>
          <el-tooltip content="立即刷新" placement="top">
            <el-button :icon="Refresh" circle :loading="mySqlLoading" @click="resetMySqlPolling" />
          </el-tooltip>
        </div>
      </header>

      <!-- MySQL 离线 -->
      <div v-if="mySqlResult && !mySqlResult.online" class="redis-offline">
        <el-tag type="danger" size="small">MySQL 不可达</el-tag>
        <span class="redis-offline-text">{{ mySqlResult.error || '数据库连接失败' }}</span>
      </div>
      <p v-else-if="mySqlError" class="num-danger">{{ mySqlError }}</p>

      <!-- MySQL 在线 -->
      <template v-else-if="mySqlResult?.online">
        <div class="stat-row mysql-stats">
          <div class="stat-cell">
            <span class="stat-label">版本</span>
            <span class="stat-value stat-value--sm">{{ mySqlResult.version ?? '-' }}</span>
          </div>
          <div class="stat-cell">
            <span class="stat-label">运行时长</span>
            <span class="stat-value stat-value--sm">{{ formatUptime(mySqlResult.uptimeSec) }}</span>
          </div>
          <div class="stat-cell">
            <span class="stat-label">当前连接</span>
            <span class="stat-value stat-value--sm">{{ mySqlResult.connections ?? '-' }}</span>
          </div>
          <div class="stat-cell">
            <span class="stat-label">全局上限</span>
            <span class="stat-value stat-value--sm">{{ mySqlResult.maxConnections ?? '-' }}</span>
          </div>
          <div class="stat-cell">
            <span class="stat-label">峰值连接</span>
            <span class="stat-value stat-value--sm">{{
              mySqlResult.maxUsedConnections ?? '-'
            }}</span>
          </div>
          <div class="stat-cell">
            <span class="stat-label">应用池上限</span>
            <span class="stat-value stat-value--sm">{{ mySqlResult.appPoolLimit ?? '-' }}</span>
          </div>
          <div class="stat-cell">
            <span class="stat-label">库总大小</span>
            <span class="stat-value stat-value--sm">{{
              formatBytes(mySqlResult.totalSizeBytes)
            }}</span>
          </div>
        </div>

        <!-- 表大小分布 -->
        <div v-if="mySqlTablesRows.length" class="redis-domains">
          <p class="redis-domains-title">表大小分布（按合计降序，前 20）</p>
          <el-table :data="mySqlTablesRows" size="small" :border="false">
            <el-table-column label="表名" prop="name" width="200" />
            <el-table-column label="行数" prop="rows" width="140" />
            <el-table-column label="数据" prop="dataHuman" width="140" />
            <el-table-column label="索引" prop="indexHuman" width="140" />
            <el-table-column label="合计" prop="totalHuman" width="140" />
          </el-table>
        </div>
      </template>
    </section>

    <!-- 队列水位 -->
    <section class="panel">
      <header class="panel-head">
        <h3 class="panel-title">云产品并发队列</h3>
        <span class="panel-sub">排队 = 等待闸门放行 · 执行中 = 已占用并发名额</span>
      </header>
      <el-table :data="snapshot?.queues ?? []" size="default" :border="false">
        <el-table-column label="队列" width="140">
          <template #default="{ row }">
            <span class="queue-name">{{ QUEUE_LABELS[row.name] ?? row.name }}</span>
          </template>
        </el-table-column>
        <el-table-column label="并发上限" width="140">
          <template #default="{ row }">
            <el-tag v-if="row.concurrency === 0" size="small" type="info">不限流</el-tag>
            <span v-else>{{ row.concurrency }}</span>
          </template>
        </el-table-column>
        <el-table-column label="排队中" width="140">
          <template #default="{ row }">
            <span :class="{ 'num-warning': row.size > 0 }">{{ row.size }}</span>
          </template>
        </el-table-column>
        <el-table-column label="执行中" width="140">
          <template #default="{ row }">{{ row.pending }}</template>
        </el-table-column>
        <el-table-column />
      </el-table>
    </section>

    <div class="panel-grid">
      <!-- 评测闸门 -->
      <section class="panel">
        <header class="panel-head">
          <h3 class="panel-title">评测并发闸门</h3>
          <span v-if="snapshot" class="panel-sub">
            近 {{ snapshot.evalGate.windowSec }} 秒发放估算
          </span>
        </header>
        <div v-if="snapshot" class="gate-body">
          <template v-if="snapshot.evalGate.limit > 0">
            <el-progress
              :percentage="gatePercent"
              :status="progressStatus(gatePercent)"
              :stroke-width="14"
            >
              <span class="progress-text">
                {{ snapshot.evalGate.active }} / {{ snapshot.evalGate.limit }}
              </span>
            </el-progress>
          </template>
          <template v-else>
            <el-tag type="info">闸门未启用</el-tag>
            <p class="gate-hint">当前窗口内实际已发放 {{ snapshot.evalGate.active }} 次评测鉴权</p>
          </template>
        </div>
      </section>

      <!-- 上传任务分布 -->
      <section class="panel">
        <header class="panel-head">
          <h3 class="panel-title">上传任务</h3>
          <span class="panel-sub">今日口径为服务器时区</span>
        </header>
        <div class="stat-row">
          <div class="stat-cell">
            <span class="stat-label">排队中</span>
            <span
              class="stat-value"
              :class="{ 'num-warning': (snapshot?.uploadTasks.queued ?? 0) > 0 }"
            >
              {{ snapshot?.uploadTasks.queued ?? '-' }}
            </span>
          </div>
          <div class="stat-cell">
            <span class="stat-label">处理中</span>
            <span class="stat-value">{{ snapshot?.uploadTasks.processing ?? '-' }}</span>
          </div>
          <div class="stat-cell">
            <span class="stat-label">今日成功</span>
            <span class="stat-value num-success">{{
              snapshot?.uploadTasks.todaySuccess ?? '-'
            }}</span>
          </div>
          <div class="stat-cell">
            <span class="stat-label">今日失败</span>
            <span
              class="stat-value"
              :class="{ 'num-danger': (snapshot?.uploadTasks.todayFailed ?? 0) > 0 }"
            >
              {{ snapshot?.uploadTasks.todayFailed ?? '-' }}
            </span>
          </div>
        </div>
      </section>
    </div>

    <!-- 本地内存兜底（Redis 正常默认折叠；Redis 回落内存态自动展开，可手动切换） -->
    <section class="panel memory-drawer">
      <el-collapse v-model="memoryCollapseActive" class="memory-collapse">
        <el-collapse-item name="memory">
          <template #title>
            <div class="memory-collapse-head">
              <span class="panel-title">本地内存兜底</span>
              <span class="memory-collapse-sub">{{ memoryCollapseSub }}</span>
            </div>
          </template>
          <div class="memory-grid">
            <!-- 埋点缓冲 -->
            <div>
              <header class="panel-head">
                <h4 class="panel-title">埋点内存缓冲</h4>
                <span class="panel-sub">超上限丢弃最旧条目（埋点为旁路可容忍）</span>
              </header>
              <div v-for="buf in snapshot?.buffers ?? []" :key="buf.name" class="buffer-item">
                <div class="buffer-head">
                  <span class="buffer-name">{{ BUFFER_LABELS[buf.name] ?? buf.name }}</span>
                  <span class="buffer-count">{{ buf.size }} / {{ buf.maxSize }}</span>
                </div>
                <el-progress
                  :percentage="percent(buf.size, buf.maxSize)"
                  :status="progressStatus(percent(buf.size, buf.maxSize))"
                  :show-text="false"
                  :stroke-width="8"
                />
                <p v-if="buf.dropped > 0" class="buffer-dropped">已丢弃 {{ buf.dropped }} 条</p>
              </div>
            </div>
            <!-- 限流滑窗 -->
            <div>
              <header class="panel-head">
                <h4 class="panel-title">限流滑窗</h4>
                <span class="panel-sub">活跃限流桶（IP/用户 × 路径组合键，非在线人数）</span>
              </header>
              <div v-if="snapshot" class="gate-body">
                <el-progress
                  :percentage="
                    percent(snapshot.rateLimiter.trackedKeys, snapshot.rateLimiter.maxEntries)
                  "
                  :status="
                    progressStatus(
                      percent(snapshot.rateLimiter.trackedKeys, snapshot.rateLimiter.maxEntries),
                    )
                  "
                  :stroke-width="14"
                >
                  <span class="progress-text">
                    {{ snapshot.rateLimiter.trackedKeys }} / {{ snapshot.rateLimiter.maxEntries }}
                  </span>
                </el-progress>
              </div>
            </div>
          </div>
        </el-collapse-item>
      </el-collapse>
    </section>

    <!-- 语音识别 STT -->
    <section class="panel">
      <header class="panel-head">
        <h3 class="panel-title">语音识别 STT</h3>
        <span class="panel-sub">标准版每日免费额度为本地聚合口径，非官方计量</span>
      </header>
      <div v-if="snapshot" class="stt-body">
        <div class="stt-quota">
          <div class="buffer-head">
            <span class="buffer-name">今日标准版已用</span>
            <span class="buffer-count">
              {{ sttUsedMinutes }} / {{ snapshot.stt.freeQuotaMin }} 分钟
            </span>
          </div>
          <el-progress
            :percentage="percent(snapshot.stt.todayBizMs, snapshot.stt.freeQuotaMin * 60000)"
            :status="
              progressStatus(percent(snapshot.stt.todayBizMs, snapshot.stt.freeQuotaMin * 60000))
            "
            :show-text="false"
            :stroke-width="10"
          />
        </div>
        <div class="stt-meta">
          <div class="stt-meta-item">
            <span class="stat-label">配置后端</span>
            <el-tag :type="snapshot.stt.backend === 'filetrans' ? 'success' : 'info'" size="small">
              {{ snapshot.stt.backend === 'filetrans' ? '标准版' : '极速版' }}
            </el-tag>
            <span
              v-if="
                snapshot.stt.lastUsedBackend &&
                snapshot.stt.lastUsedBackend !== snapshot.stt.backend
              "
              class="num-warning stt-hint"
            >
              最近实际走{{ snapshot.stt.lastUsedBackend === 'flash' ? '极速版' : '标准版' }}
            </span>
          </div>
          <div class="stt-meta-item">
            <span class="stat-label">今日自动回退</span>
            <span
              class="stat-value stat-value--sm"
              :class="{ 'num-warning': snapshot.stt.todayFallbacks > 0 }"
            >
              {{ snapshot.stt.todayFallbacks }} 次
            </span>
          </div>
          <div class="stt-meta-item">
            <span class="stat-label">试用剩余</span>
            <span v-if="snapshot.stt.trialDaysLeft === null" class="stat-value stat-value--sm">
              未设置
            </span>
            <span
              v-else
              class="stat-value stat-value--sm"
              :class="trialToneClass(snapshot.stt.trialDaysLeft)"
            >
              {{ snapshot.stt.trialDaysLeft >= 0 ? `${snapshot.stt.trialDaysLeft} 天` : '已到期' }}
            </span>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { Refresh } from '@element-plus/icons-vue'
import { useAdminMonitor, useAdminMySql, useAdminRedisBackup } from '~/composables/admin'
import { usePermission } from '~/composables/user'
import { PERMISSIONS } from '#shared/utils/permission'
import type { AdminMonitorSnapshot } from '#shared/types/adminMonitor'
import type { MySqlMonitorResult } from '#shared/types/mysqlMonitor'
import type { RedisBackupResult } from '~/api/admin/monitor'

definePageMeta({ layout: 'admin', title: '运行监控' })

const QUEUE_LABELS: Record<string, string> = {
  tts: 'TTS 语音合成',
  nls: 'NLS 语音识别',
  deepseek: 'DeepSeek',
  upload: '材料上传流水线',
}

const BUFFER_LABELS: Record<string, string> = {
  apiCallLog: 'API 调用埋点',
  cloudServiceLog: '云服务调用埋点',
}

const { isLoading, execute } = useAdminMonitor()
const { isLoading: mySqlLoading, execute: mySqlExecute } = useAdminMySql()
const { isLoading: backupIsLoading, execute: backupExecute } = useAdminRedisBackup()
const { can } = usePermission()
const canBackup = computed(() => can(PERMISSIONS.OPS_BACKUP))

const snapshot = ref<AdminMonitorSnapshot | null>(null)

// MySQL 独立状态（30s 低频轮询 + 手动刷新）
const mySqlResult = ref<MySqlMonitorResult | null>(null)
const mySqlError = ref('')

// Redis RDB 备份结果
const backupResult = ref<RedisBackupResult | null>(null)
const backupError = ref('')

// 固定 5s 轮询（factor:1 不衰减）：tick 不返回 true 永不自停；
// 页面隐藏自动停表、回到可见立即刷新、组件卸载自动清理均由 usePolling 提供
const { start, reset } = usePolling(
  async () => {
    const res = await execute(null, { silent: true })
    // 轮询与手动刷新并发时防重锁返回 code -2，忽略本轮
    if (res?.code === 200 && res.data) {
      snapshot.value = res.data
    }
  },
  { baseMs: 5000, factor: 1 },
)

// MySQL 30s 独立轮询（factor:1 不衰减）：不随 5s 主轮询放大；
// 页面隐藏自动停表、回到可见立即刷新同样由 usePolling 提供
const { start: startMySqlPolling, reset: resetMySqlPolling } = usePolling(
  async () => {
    await loadMySql()
  },
  { baseMs: 30000, factor: 1 },
)

async function loadMySql() {
  const res = await mySqlExecute(null, { silent: true })
  if (res?.code === 200 && res.data) {
    mySqlResult.value = res.data
    mySqlError.value = ''
  } else if (res?.code !== -2) {
    // -2 = 防重锁（轮询与手动刷新并发），忽略本轮不报错
    mySqlError.value = res?.message || '获取 MySQL 状态失败'
  }
}

async function handleTriggerBackup() {
  backupError.value = ''
  backupResult.value = null
  const res = await backupExecute(null)
  if (res?.code === 200 && res.data) {
    backupResult.value = res.data
  } else if (res?.code !== -2) {
    backupError.value = res?.message || '触发 RDB 备份失败'
  }
}

onMounted(() => {
  start()
  startMySqlPolling()
})

// 本地内存兜底抽屉：默认折叠；Redis 回落内存态（online=false）自动展开、恢复在线自动收起，用户可手动切换
const memoryCollapseActive = ref<string[]>([])
const memoryCollapseSub = computed(() =>
  snapshot.value?.redis?.online === false
    ? 'Redis 不可用 · 已回落内存态'
    : 'Redis 正常 · 内存缓冲为降级兜底',
)

watch(
  () => snapshot.value?.redis?.online,
  (online, prev) => {
    if (online === false) {
      if (!memoryCollapseActive.value.includes('memory')) {
        memoryCollapseActive.value = [...memoryCollapseActive.value, 'memory']
      }
    } else if (online === true && prev === false) {
      memoryCollapseActive.value = memoryCollapseActive.value.filter((n) => n !== 'memory')
    }
  },
)

const redisDomainsRows = computed(() => {
  const domains = snapshot.value?.redis.domains
  if (!domains) return []
  return Object.entries(domains).map(([name, stat]) => ({
    name,
    keys: stat.keys,
    expiring: stat.expiring,
    noTtl: stat.noTtl,
  }))
})

const redisMaxMemoryText = computed(() => {
  const max = snapshot.value?.redis.info?.maxMemoryBytes
  if (max === undefined || max === null) return '-'
  if (max === 0) return '无限制'
  return formatBytes(max)
})

const mySqlTablesRows = computed(() => {
  const tables = mySqlResult.value?.tables
  if (!tables) return []
  return tables
    .slice()
    .sort((a, b) => b.dataBytes + b.indexBytes - (a.dataBytes + a.indexBytes))
    .slice(0, 20)
    .map((t) => ({
      name: t.name,
      rows: t.rows,
      dataHuman: formatBytes(t.dataBytes),
      indexHuman: formatBytes(t.indexBytes),
      totalHuman: formatBytes(t.dataBytes + t.indexBytes),
    }))
})

const gatePercent = computed(() => {
  if (!snapshot.value || snapshot.value.evalGate.limit <= 0) return 0
  return percent(snapshot.value.evalGate.active, snapshot.value.evalGate.limit)
})

const sttUsedMinutes = computed(() => {
  if (!snapshot.value) return 0
  return Math.round((snapshot.value.stt.todayBizMs / 60000) * 10) / 10
})

/** 试用倒计时着色：≤3 天 danger、≤14 天 warning */
function trialToneClass(daysLeft: number): string {
  if (daysLeft <= 3) return 'num-danger'
  if (daysLeft <= 14) return 'num-warning'
  return 'num-success'
}

function percent(value: number, max: number): number {
  if (max <= 0) return 0
  return Math.min(100, Math.round((value / max) * 100))
}

/** 占比着色：<70% 正常、70-90% 警示、≥90% 危险 */
function progressStatus(pct: number): 'success' | 'warning' | 'exception' {
  if (pct >= 90) return 'exception'
  if (pct >= 70) return 'warning'
  return 'success'
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/** 字节数人类可读（B/KB/MB/GB/TB），null/undefined 显示 - */
function formatBytes(bytes?: number | null): string {
  if (bytes === undefined || bytes === null) return '-'
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let val = bytes
  let i = -1
  do {
    val /= 1024
    i += 1
  } while (val >= 1024 && i < units.length - 1)
  return `${val.toFixed(1)} ${units[i]}`
}

/** 秒数人类可读（刚刚 / X 分钟前 / X 小时前 / X 天前），null/undefined 显示 - */
function formatAgo(sec?: number | null): string {
  if (sec === undefined || sec === null) return '-'
  if (sec < 60) return '刚刚'
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min} 分钟前`
  const hour = Math.floor(min / 60)
  if (hour < 24) return `${hour} 小时前`
  return `${Math.floor(hour / 24)} 天前`
}

/** 运行时长人类可读（X 天 X 小时 / X 小时 X 分 / X 分钟 / X 秒） */
function formatUptime(sec?: number | null): string {
  if (sec === undefined || sec === null) return '-'
  const day = Math.floor(sec / 86400)
  const hour = Math.floor((sec % 86400) / 3600)
  const min = Math.floor((sec % 3600) / 60)
  if (day > 0) return `${day} 天 ${hour} 小时`
  if (hour > 0) return `${hour} 小时 ${min} 分`
  if (min > 0) return `${min} 分钟`
  return `${Math.floor(sec)} 秒`
}
</script>

<style scoped>
.monitor-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* ===== 页头 ===== */
.page-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
}

.page-title {
  font-size: 20px;
  font-weight: 700;
  color: var(--text-1);
}

.page-desc {
  margin-top: 4px;
  font-size: 12px;
  color: var(--text-3);
  display: flex;
  align-items: center;
  gap: 6px;
}

.live-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--success, #67c23a);
  animation: live-pulse 2s ease-in-out infinite;
}

@keyframes live-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.35;
  }
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.snapshot-time {
  font-size: 12px;
  color: var(--text-3);
}

/* ===== 面板 ===== */
.panel {
  background: var(--card);
  border: 1px solid var(--border-ll);
  border-radius: var(--r-lg, 12px);
  padding: 16px 20px;
}

.panel-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}

.panel-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 12px;
}

.panel-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-1);
}

.panel-sub {
  font-size: 12px;
  color: var(--text-3);
}

.queue-name {
  font-weight: 500;
}

/* ===== 闸门 / 滑窗 ===== */
.gate-body {
  padding: 8px 0;
}

.progress-text {
  font-size: 13px;
  font-variant-numeric: tabular-nums;
}

.gate-hint {
  margin-top: 8px;
  font-size: 12px;
  color: var(--text-3);
}

/* ===== 上传任务四格 ===== */
.stat-row {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
}

.stat-cell {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 0;
}

.stat-label {
  font-size: 12px;
  color: var(--text-3);
}

.stat-value {
  font-size: 22px;
  font-weight: 700;
  color: var(--text-1);
  font-variant-numeric: tabular-nums;
}

/* ===== 缓冲 ===== */
.buffer-item {
  margin-bottom: 14px;
}

.buffer-item:last-child {
  margin-bottom: 0;
}

.buffer-head {
  display: flex;
  justify-content: space-between;
  margin-bottom: 6px;
  font-size: 13px;
}

.buffer-name {
  color: var(--text-2);
}

.buffer-count {
  color: var(--text-3);
  font-variant-numeric: tabular-nums;
}

.buffer-dropped {
  margin-top: 4px;
  font-size: 12px;
  color: var(--danger, #f56c6c);
}

/* ===== 数值着色 ===== */
.num-warning {
  color: var(--warning, #e6a23c);
  font-weight: 600;
}

.num-success {
  color: var(--success, #67c23a);
}

.num-danger {
  color: var(--danger, #f56c6c);
}

/* ===== Redis / MySQL 状态 ===== */
.redis-stats,
.mysql-stats {
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
}

.redis-offline {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 0;
}

.redis-offline-text {
  font-size: 13px;
  color: var(--text-2);
}

.backup-line {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 10px;
  font-size: 12px;
  color: var(--text-2);
}

.redis-domains {
  margin-top: 16px;
}

.redis-domains-title {
  margin-bottom: 8px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-2);
}

/* ===== 本地内存兜底抽屉 ===== */
.memory-collapse {
  border: none;
}

.memory-collapse-head {
  display: flex;
  align-items: baseline;
  gap: 12px;
}

.memory-collapse-sub {
  font-size: 12px;
  color: var(--text-3);
}

.memory-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 24px;
}

/* ===== STT ===== */
.stt-body {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 24px;
  align-items: center;
}

.stt-meta {
  display: flex;
  gap: 28px;
  flex-wrap: wrap;
}

.stt-meta-item {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.stat-value--sm {
  font-size: 16px;
}

.stt-hint {
  font-size: 12px;
}

@media (max-width: 900px) {
  .stt-body {
    grid-template-columns: 1fr;
  }
}

/* 窄屏降级单列 */
@media (max-width: 900px) {
  .panel-grid {
    grid-template-columns: 1fr;
  }

  .memory-grid {
    grid-template-columns: 1fr;
  }
}
</style>
