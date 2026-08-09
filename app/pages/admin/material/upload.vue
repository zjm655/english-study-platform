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
          </el-form-item>
          <el-form-item label="标题">
            <el-input v-model="title" placeholder="可选，留空则自动生成" style="width: 420px" />
          </el-form-item>
          <el-form-item label="音频">
            <el-upload
              :auto-upload="false"
              :limit="1"
              accept="audio/*"
              :on-change="handleAudioChange"
              :on-remove="handleAudioRemove"
            >
              <el-button type="primary" plain>选择音频（可选）</el-button>
              <template #tip>
                <div class="upload-tip">
                  不上传则用 TTS 合成；上传则校验音频与文本一致性。管理员上限 10 分钟 / 5MB。
                </div>
              </template>
            </el-upload>
          </el-form-item>
          <!-- 仅本次上传包含音频时出现：NLS 语音校对开关（默认关闭）。
               开启后消耗 NLS 额度（标准版每日 2h 免费 / 极速版按量），识别+文本核验任一失败整单失败 -->
          <el-form-item v-if="audioFile" label="NLS 校对">
            <el-switch v-model="nlsCheck" active-text="开启语音校对" inactive-text="关闭" />
            <span class="nls-tip">
              开启后上传时对音频做语音识别，核验音频内容与材料文本一致（消耗 NLS 额度）
            </span>
          </el-form-item>
        </el-form>
      </div>

      <!-- 批量模式 -->
      <div v-else class="mode-panel">
        <el-upload
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
              每个 txt 首行为标题，正文为材料原文；批量模式不上传音频，统一 TTS 合成。
            </div>
          </template>
        </el-upload>
      </div>

      <div class="submit-row">
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
import { useAdminUpload } from '~/composables/admin'
import { useUnits } from '~/composables/unit'
import type { AdminUploadResponse } from '#shared/types/adminUpload'
import type { UnitWithProgress } from '#shared/types/unit'
import type { UploadFile, UploadFiles } from 'element-plus'

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
const audioFile = ref<File | null>(null)
// NLS 语音校对开关（默认关闭：管理员材料多来自权威来源，开启会消耗 NLS 额度并增加失败概率；
// 需要核验音频与文本一致性时再显式开启）
const nlsCheck = ref(false)

// 批量模式
const txtFiles = ref<File[]>([])

// 单元列表
const units = ref<UnitWithProgress[]>([])

const { isLoading, execute } = useAdminUpload()
const { execute: executeUnits } = useUnits()
const result = ref<AdminUploadResponse | null>(null)

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
    if (title.value.trim()) fd.append('title', title.value.trim())
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
    for (const f of txtFiles.value) fd.append('files', f)
  }

  const res = await execute(fd)
  if (res?.code === 200 && res.data) {
    result.value = res.data
  }
}

onMounted(() => {
  loadUnits()
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

.nls-tip {
  margin-left: 12px;
  font-size: 12px;
  color: var(--text-4);
  line-height: 1.6;
}

.submit-row {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid var(--border-ll);
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
