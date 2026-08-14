<template>
  <div class="upload-page">
    <div class="page-header">
      <h2 class="page-title">材料上传</h2>
      <p class="page-desc">上传学习材料，系统自动生成翻译、重点词汇与理解题。</p>
    </div>

    <el-card class="upload-card">
      <!-- 公共参数 -->
      <el-form label-width="90px" class="upload-form">
        <el-form-item label="所属单元">
          <el-select v-model="unitId" placeholder="选择单元" style="width: 320px">
            <el-option v-for="u in units" :key="u.id" :label="u.title" :value="u.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="朗读音色">
          <el-select v-model="voice" style="width: 320px">
            <el-option v-for="v in voices" :key="v" :label="v" :value="v" />
          </el-select>
        </el-form-item>
        <el-form-item label="是否公开">
          <el-switch v-model="isPublic" active-text="公开" inactive-text="私有" />
        </el-form-item>
        <el-form-item label="上传模式">
          <el-radio-group v-model="mode">
            <el-radio-button value="single">单条上传</el-radio-button>
            <el-radio-button value="batch">批量上传</el-radio-button>
          </el-radio-group>
        </el-form-item>
      </el-form>

      <!-- 单条模式 -->
      <div v-if="mode === 'single'" class="mode-panel">
        <el-form label-width="90px">
          <el-form-item label="材料文本">
            <el-input
              v-model="textContent"
              type="textarea"
              :rows="6"
              maxlength="5000"
              show-word-limit
              placeholder="输入英文材料原文（10-5000 字符）"
            />
            <div class="text-file-row">
              <el-upload
                ref="textFileUploadRef"
                :auto-upload="false"
                :limit="1"
                accept=".txt,.md"
                :on-change="handleTextFileChange"
                :on-remove="handleTextFileRemove"
                :on-exceed="handleTextFileExceed"
              >
                <el-button type="primary" plain size="small">选择文本文件</el-button>
                <template #tip>
                  <div class="upload-tip">也可选择 txt 文本文件，内容将填入上方文本域可编辑</div>
                </template>
              </el-upload>
            </div>
          </el-form-item>
          <el-form-item label="标题">
            <el-radio-group v-model="titleMode" class="title-mode-group">
              <el-radio-button value="ai">AI 生成</el-radio-button>
              <el-radio-button value="manual">手动填写</el-radio-button>
              <el-radio-button value="text_filename">文本文件名</el-radio-button>
              <el-radio-button value="audio_filename">音频文件名</el-radio-button>
              <el-radio-button value="inline">正文 # 标题</el-radio-button>
            </el-radio-group>
            <div class="upload-tip title-mode-tip">{{ titleModeTip }}</div>
          </el-form-item>
          <el-form-item v-if="titleMode === 'manual'" label="">
            <el-input v-model="title" placeholder="请输入标题" style="width: 420px" />
          </el-form-item>
          <el-form-item label="音频">
            <el-upload
              ref="audioUploadRef"
              :auto-upload="false"
              :limit="1"
              accept="audio/*"
              :on-change="handleAudioChange"
              :on-remove="handleAudioRemove"
            >
              <el-button type="primary" plain>选择音频（可选）</el-button>
              <template #tip>
                <div class="upload-tip">
                  不上传则用 TTS 合成；上传则校验音频与文本一致性。管理员上限
                  {{ formatDurationMin(maxAudioDurationAdmin) }} /
                  {{ formatSizeMB(maxAudioSizeAdmin) }}。
                </div>
              </template>
            </el-upload>
          </el-form-item>
          <!-- 仅本次上传包含音频时出现：NLS 语音校对开关（默认开启）。
               开启后消耗 NLS 额度（标准版每日 2h 免费 / 极速版按量），识别+文本核验任一失败整单失败 -->
          <el-form-item v-if="audioFile" label="NLS 校对">
            <div class="nls-control">
              <div class="nls-switch-row">
                <el-switch
                  v-model="nlsCheck"
                  @change="handleNlsChange"
                  active-text="开启语音校对"
                  inactive-text="关闭"
                />
                <span class="nls-tip">
                  开启后上传时对音频做语音识别，核验音频内容与材料文本一致（消耗 NLS 额度）
                </span>
              </div>
              <!-- 今日免费额度透明度展示 -->
              <div v-if="nlsQuota" class="nls-quota">
                <template v-if="nlsQuota.backend === 'filetrans'">
                  <span>今日免费额度已用 {{ nlsQuota.usedPercent }}%，剩余 {{ nlsQuota.remainingMin }} 分钟</span>
                  <span v-if="quotaWarning" class="nls-quota-warn">
                    已超过 {{ nlsQuota.warnThresholdPercent }}%，超出部分将按量付费
                    {{ nlsQuota.paidUnitPricePerHour }} 元/小时
                  </span>
                </template>
                <template v-else>
                  <span>当前 STT 为按量付费（{{ nlsQuota.paidUnitPricePerHour }} 元/小时），无免费额度</span>
                </template>
              </div>
            </div>
          </el-form-item>
        </el-form>
      </div>

      <!-- 批量模式 -->
      <div v-else class="mode-panel">
        <el-form label-width="90px">
          <el-form-item label="标题">
            <el-radio-group v-model="titleMode" class="title-mode-group">
              <el-radio-button value="ai">AI 生成</el-radio-button>
              <el-radio-button value="text_filename">文本文件名</el-radio-button>
              <el-radio-button value="inline">正文 # 标题</el-radio-button>
            </el-radio-group>
            <div class="upload-tip title-mode-tip">{{ titleModeTip }}</div>
          </el-form-item>
        </el-form>
        <el-upload
          ref="txtUploadRef"
          :auto-upload="false"
          multiple
          accept=".txt"
          :limit="20"
          :on-change="handleTxtChange"
          :on-remove="handleTxtRemove"
          :on-exceed="handleTxtExceed"
        >
          <el-button type="primary" plain>选择 txt 文件（最多 20 个）</el-button>
          <template #tip>
            <div class="upload-tip">
              标题由「标题生成方式」决定：inline 模式以每个 txt 首行 `# ` 为标题（无 `# `
              则首行为正文），文本文件名模式以文件名（txt 文件名）为标题；批量模式不上传音频，统一
              TTS 合成。
            </div>
          </template>
        </el-upload>
      </div>

      <div class="submit-row">
        <div class="submit-actions">
          <!-- 清空材料：仅清空文本/音频输入（保留标题生成方式等设置，便于连续上传多个材料） -->
          <el-button plain @click="handleResetMaterials">清空材料</el-button>
          <!-- 重置全部：整个表单回初始状态（含标题/音色/可见范围/单元/回执） -->
          <el-button plain @click="handleResetAll">重置全部</el-button>
        </div>
        <el-button type="primary" :loading="isLoading" @click="handleSubmit">
          {{ mode === 'single' ? '上传材料' : '批量上传' }}
        </el-button>
      </div>
    </el-card>

    <!-- 入队回执（异步任务：实际处理进度请到“上传记录”页查看） -->
    <el-card v-if="result" class="result-card">
      <template #header>
        <div class="result-summary">
          <span>入队回执</span>
          <span>
            共 {{ result.summary.total }} 条，
            <span class="result-success">已入队 {{ result.summary.success }}</span
            >，
            <span class="result-failed">被拒 {{ result.summary.failed }}</span>
          </span>
        </div>
      </template>
      <el-table :data="result.results" stripe>
        <el-table-column label="#" width="60">
          <template #default="{ row }">{{ row.index + 1 }}</template>
        </el-table-column>
        <el-table-column label="状态" width="90">
          <template #default="{ row }">
            <el-tag :type="row.success ? 'success' : 'danger'" size="small">
              {{ row.success ? '已入队' : '被拒' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="title" label="标题" />
        <el-table-column prop="error" label="错误信息" />
        <el-table-column label="提示">
          <template #default="{ row }">
            <el-tag v-if="row.notice" type="warning" size="small">{{ row.notice }}</el-tag>
          </template>
        </el-table-column>
      </el-table>
      <div class="result-footer">
        材料已加入处理队列，请到
        <NuxtLink to="/admin/material/records" class="result-link">上传记录</NuxtLink>
        页查看处理进度。
      </div>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { useAdminUpload, useAdminNlsQuota } from '~/composables/admin'
import { useUnits } from '~/composables/unit'
import type { AdminUploadResponse } from '#shared/types/adminUpload'
import type { UnitWithProgress } from '#shared/types/unit'
import type { NlsQuotaInfo } from '#shared/types/nlsQuota'
import type { UploadFile, UploadFiles, UploadInstance } from 'element-plus'

definePageMeta({
  layout: 'admin',
  title: '材料上传',
})

useSeoMeta({ title: '材料上传 - 管理后台' })

// 与后端 ALLOWED_VOICES 白名单一致
const voices = [
  'en-US-AriaNeural',
  'en-US-GuyNeural',
  'en-US-JennyNeural',
  'en-GB-SoniaNeural',
  'en-GB-RyanNeural',
]

// 公共参数
const unitId = ref(0)
const voice = ref('en-US-AriaNeural')
const isPublic = ref(true)
const mode = ref<'single' | 'batch'>('single')

// 单条模式
const textContent = ref('')
const title = ref('')
// 标题生成方式：ai=AI 生成 / manual=手动填写 / text_filename=文本文件名 / audio_filename=音频文件名 / inline=正文 # 标题（批量模式无 manual/audio_filename）
const titleMode = ref<'ai' | 'manual' | 'text_filename' | 'audio_filename' | 'inline'>('ai')
// 所选文本文件名（text_filename 标题模式使用；移除文件时清空，正文不清空）
const textFileName = ref('')
const audioFile = ref<File | null>(null)
// NLS 语音校对开关（默认开启：管理员上传音频默认核验音频与文本一致性，改为关闭时提示副作用）
const nlsCheck = ref(true)
// 今日 NLS 免费额度信息（仅含音频时展示，用于透明度与超阈值按量付费提示）
const nlsQuota = ref<NlsQuotaInfo | null>(null)

// 批量模式
const txtFiles = ref<File[]>([])

// el-upload 实例（重置/清空时同步清空组件内部文件列表）
const textFileUploadRef = ref<UploadInstance>()
const audioUploadRef = ref<UploadInstance>()
const txtUploadRef = ref<UploadInstance>()

// 单元列表
const units = ref<UnitWithProgress[]>([])

const { isLoading, execute } = useAdminUpload()
const { execute: executeUnits } = useUnits()
const { execute: executeNlsQuota } = useAdminNlsQuota()
const result = ref<AdminUploadResponse | null>(null)

// 上传限制来自 sys_config（管理端可调）：composable 未就绪/拉取失败时降级内置静态默认
const { limits: uploadLimits } = useUploadLimits()
const maxAudioDurationAdmin = computed(
  () => uploadLimits.value?.maxAudioDurationAdmin ?? UPLOAD_LIMITS_FALLBACK.maxAudioDurationAdmin,
)
const maxAudioSizeAdmin = computed(
  () => uploadLimits.value?.maxAudioSizeAdmin ?? UPLOAD_LIMITS_FALLBACK.maxAudioSizeAdmin,
)

/** 秒 → 分钟展示文案（整数直显，非整数保留 1 位小数） */
function formatDurationMin(sec: number): string {
  const min = sec / 60
  return `${Number.isInteger(min) ? min : min.toFixed(1)} 分钟`
}

/** 字节 → MB 展示文案（整数直显，非整数保留 1 位小数） */
function formatSizeMB(bytes: number): string {
  const mb = bytes / (1024 * 1024)
  return `${Number.isInteger(mb) ? mb : mb.toFixed(1)}MB`
}

// 免费额度超阈值提示：NLS 校对开启 + filetrans 后端 + 已用百分比超过阈值
const quotaWarning = computed(
  () =>
    nlsCheck.value &&
    !!nlsQuota.value &&
    nlsQuota.value.backend === 'filetrans' &&
    nlsQuota.value.usedPercent > nlsQuota.value.warnThresholdPercent,
)

// 仅用户手动切换开关时触发（el-switch change 事件），程序化重置不提示
function handleNlsChange(val: string | number | boolean) {
  if (val === false) {
    toastWarning('关闭后音频不再做内容一致性核验，可能放行与文本不匹配的音频')
  }
}

// 各标题生成方式的提示文案
const titleModeTip = computed(() => {
  switch (titleMode.value) {
    case 'manual':
      return '手动填写标题'
    case 'text_filename':
      return '将使用文本文件名作为标题（超过 50 字符自动截取）'
    case 'audio_filename':
      return '将使用音频文件名作为标题（超过 50 字符自动截取）'
    case 'inline':
      return '正文第一行以 `# ` 开头即作为标题，例如 `# A Day at the Park`'
    default:
      return 'AI 根据内容生成，失败时截取正文前 50 字符'
  }
})

// 批量模式不支持手动填写与音频文件名：从 single 切到 batch 时回退 ai，避免 radio 无选中项
watch(mode, (m) => {
  if (m === 'batch' && (titleMode.value === 'manual' || titleMode.value === 'audio_filename')) {
    titleMode.value = 'ai'
  }
})

async function loadUnits() {
  const res = await executeUnits(undefined)
  if (res?.code === 200 && res.data) {
    units.value = res.data
  }
}

function handleAudioChange(file: UploadFile) {
  audioFile.value = file.raw ?? null
}
function handleAudioRemove() {
  audioFile.value = null
}

// 选择文本文件：读取内容填入文本域（可继续编辑），并记录文件名
async function handleTextFileChange(file: UploadFile) {
  const raw = file.raw
  if (!raw) return
  try {
    const content = await raw.text()
    // 与文本域 maxlength 保持一致，避免超长文件撑爆输入框
    textContent.value = content.slice(0, 5000)
    textFileName.value = raw.name
  } catch {
    toastWarning('读取文本文件失败，请重试或手动粘贴内容')
  }
}
function handleTextFileRemove() {
  // 仅清空文件名（text_filename 标题模式回退），不清空已填入的正文
  textFileName.value = ''
}
function handleTextFileExceed() {
  toastWarning('最多选择一个文本文件，请先移除已选文件')
}

function collectTxtFiles(fileList: UploadFiles) {
  txtFiles.value = fileList.map((f) => f.raw).filter((f) => !!f) as File[]
}
function handleTxtChange(_file: UploadFile, fileList: UploadFiles) {
  collectTxtFiles(fileList)
}
function handleTxtRemove(_file: UploadFile, fileList: UploadFiles) {
  collectTxtFiles(fileList)
}
function handleTxtExceed() {
  toastWarning('单次批量上传不能超过 20 个文件')
}

async function handleSubmit() {
  // 每次提交先清空上次入队回执：失败后不残留旧回执卡（loading 复位由 useHandleRes 保证，可立即重提）
  result.value = null
  const fd = new FormData()
  fd.append('mode', mode.value)
  fd.append('unitId', String(unitId.value))
  fd.append('voice', voice.value)
  fd.append('isPublic', isPublic.value ? '1' : '0')

  if (mode.value === 'single') {
    if (textContent.value.trim().length < 10) {
      toastWarning('材料文本不能少于 10 个字符')
      return
    }
    fd.append('textContent', textContent.value.trim())
    fd.append('titleMode', titleMode.value)
    if (titleMode.value === 'manual') {
      if (!title.value.trim()) {
        toastWarning('请填写标题')
        return
      }
      fd.append('title', title.value.trim())
    }
    if (titleMode.value === 'text_filename') {
      const fileName = textFileName.value
      if (!fileName) {
        toastWarning('请先选择文本文件')
        return
      }
      fd.append('fileName', fileName)
    }
    if (titleMode.value === 'audio_filename') {
      const fileName = audioFile.value?.name ?? ''
      if (!fileName) {
        toastWarning('请先选择音频文件')
        return
      }
      fd.append('fileName', fileName)
    }
    if (audioFile.value) {
      fd.append('audio', audioFile.value)
      // 仅含音频时提交 NLS 校对开关（未选音频时为关）
      fd.append('nlsCheck', nlsCheck.value ? '1' : '0')
    }
  } else {
    if (!txtFiles.value.length) {
      toastWarning('请至少选择一个 txt 文件')
      return
    }
    fd.append('titleMode', titleMode.value)
    for (const f of txtFiles.value) fd.append('files', f)
  }

  const res = await execute(fd)
  if (res?.code === 200 && res.data) {
    result.value = res.data
  }
}

// 清空材料输入：单条模式清文本框/文本文件/音频（保留标题模式、音色、可见范围、单元等设置，
// 便于连续上传多个材料——音频只能一个个上传）；批量模式清空 txt 文件列表
function handleResetMaterials() {
  if (mode.value === 'single') {
    textContent.value = ''
    textFileName.value = ''
    audioFile.value = null
    nlsCheck.value = true
    textFileUploadRef.value?.clearFiles()
    audioUploadRef.value?.clearFiles()
  } else {
    txtFiles.value = []
    txtUploadRef.value?.clearFiles()
  }
}

// 重置全部：整个表单回初始状态（含标题模式、标题、音色、可见范围、单元、批量文件与入队回执）
function handleResetAll() {
  handleResetMaterials()
  titleMode.value = 'ai'
  title.value = ''
  voice.value = 'en-US-AriaNeural'
  isPublic.value = true
  unitId.value = 0
  result.value = null
}

onMounted(async () => {
  loadUnits()
  // 静默拉取今日 NLS 免费额度（只读，失败不打扰，展示逻辑由 v-if="nlsQuota" 兜底）
  const res = await executeNlsQuota(undefined, { silent: true })
  if (res?.code === 200 && res.data) {
    nlsQuota.value = res.data
  }
})
</script>

<style scoped>
/* PC 后台页面：铺满 admin 布局内容区，不限宽（移动端才需 max-width 约束） */
.upload-page {
  width: 100%;
}

.page-header {
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

.upload-card {
  margin-bottom: 20px;
}

.mode-panel {
  margin-top: 8px;
}

.upload-tip {
  font-size: 12px;
  color: var(--text-3);
  line-height: 1.6;
}

.text-file-row {
  width: 100%;
  margin-top: 8px;
}

/* 标题模式 radio-button 组：窄容器下换行排列，行间 8px 间距；column-gap 默认 0 保持同排按钮连排 */
.title-mode-group {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  row-gap: 8px;
}

.title-mode-tip {
  width: 100%;
  margin-top: 4px;
}

.nls-control {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.nls-switch-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.nls-tip {
  font-size: 12px;
  color: var(--text-4);
  line-height: 1.6;
}

.nls-quota {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 8px;
  font-size: 12px;
  color: var(--text-3);
  line-height: 1.6;
}

.nls-quota-warn {
  color: var(--el-color-warning, #e6a23c);
}

.submit-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid var(--border-ll);
}

.submit-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.result-summary {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 14px;
}

.result-success {
  color: var(--el-color-success, #67c23a);
}

.result-failed {
  color: var(--el-color-danger, #f56c6c);
}

.result-footer {
  margin-top: 12px;
  font-size: 13px;
  color: var(--text-3);
}

.result-link {
  color: var(--primary);
  text-decoration: none;
}
</style>
