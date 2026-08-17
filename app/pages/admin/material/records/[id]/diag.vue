<template>
  <div class="diag-page">
    <div class="page-header">
      <div class="page-header__left">
        <el-button text @click="goBack">
          <el-icon><Back /></el-icon><span>返回记录列表</span>
        </el-button>
        <div>
          <h2 class="page-title">上传任务诊断 #{{ id }}</h2>
          <p class="page-desc">流水线各阶段结果与上传现场，用于失败回溯</p>
        </div>
      </div>
    </div>

    <el-empty v-if="loadError" :description="loadError">
      <el-button @click="goBack">返回列表</el-button>
    </el-empty>

    <template v-else>
      <!-- 基础信息 -->
      <el-card v-loading="loading" shadow="never" class="card">
        <template #header><span class="card-title">基础信息</span></template>
        <el-descriptions :column="2">
          <el-descriptions-item label="标题">{{ diag?.title }}</el-descriptions-item>
          <el-descriptions-item label="状态">
            <el-tag :type="diag?.status === 'success' ? 'success' : diag?.status === 'failed' ? 'danger' : 'warning'" size="small">
              {{ statusText }}
            </el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="来源">{{ diag?.source === 'admin' ? '管理员' : '用户' }}</el-descriptions-item>
          <el-descriptions-item label="上传者">{{ diag?.username }}</el-descriptions-item>
          <el-descriptions-item label="创建时间">{{ formatDate(diag?.createdAt) }}</el-descriptions-item>
          <el-descriptions-item label="更新时间">{{ formatDate(diag?.updatedAt) }}</el-descriptions-item>
          <el-descriptions-item v-if="diag?.error_message" label="失败原因" :span="2">
            <div class="pre error-text">{{ diag.error_message }}</div>
          </el-descriptions-item>
        </el-descriptions>
      </el-card>

      <!-- 流水线流程图 -->
      <el-card shadow="never" class="card">
        <template #header><span class="card-title">流水线流程图</span></template>
        <PipelineFlowChart :diagram="diagram" />
        <p class="page-desc">绿=成功 / 红=失败终点 / 黄=异常(非阻塞) / 灰=未开始或未走分支；失败在失败节点断链，其后未执行阶段与「完成」置灰且不被箭头连通</p>
      </el-card>

      <!-- 上传文本 -->
      <el-card shadow="never" class="card">
        <template #header><span class="card-title">上传文本</span></template>
        <div class="pre">{{ diag?.text_content }}</div>
      </el-card>

      <!-- 音频 -->
      <el-card v-if="diag?.audioUrl" shadow="never" class="card">
        <template #header><span class="card-title">音频</span></template>
        <AudioPlayer :src="diag.audioUrl" />
      </el-card>

      <!-- NLS 转写 -->
      <el-card v-if="diag?.nls_check === 1" shadow="never" class="card">
        <template #header><span class="card-title">NLS 转写</span></template>
        <div v-if="diag?.nls_transcript" class="pre">{{ diag.nls_transcript }}</div>
        <span v-else class="text-muted">无转写（识别失败或未产生转写文本）</span>
      </el-card>

      <!-- DeepSeek 生成内容（AI 返回）：词汇/题目/翻译 + 重点词汇 TTS 音频结果 -->
      <el-card v-if="aiContent" shadow="never" class="card">
        <template #header><span class="card-title">DeepSeek 生成内容（AI 返回）</span></template>
        <el-empty
          v-if="!aiContent.translation && !(aiContent.vocabulary && aiContent.vocabulary.length)"
          description="无 AI 生成内容"
          :image-size="60"
        />
        <template v-else>
          <div class="sub-title">中文翻译</div>
          <div class="pre">{{ aiContent.translation || '（无）' }}</div>

          <div class="sub-title">重点词汇（{{ aiContent.vocabulary?.length || 0 }}）</div>
          <ul class="vocab-list">
            <li v-for="(v, i) in aiContent.vocabulary || []" :key="i">
              {{ v.word }} · {{ v.phonetic || '' }} · {{ v.meaning }}
              <el-tag
                v-if="vocabAudioState(v.word)"
                :type="vocabAudioState(v.word) === 'ok' ? 'success' : 'warning'"
                size="small"
                class="audio-badge"
              >
                音频{{ vocabAudioState(v.word) === 'ok' ? '✓' : '✗' }}
              </el-tag>
            </li>
          </ul>

          <div class="sub-title">理解题（{{ aiContent.questions?.length || 0 }}）</div>
          <template v-if="aiContent.questions && aiContent.questions.length">
            <div v-for="(q, qi) in aiContent.questions" :key="qi" class="question-item">
              <div class="question-text">{{ qi + 1 }}. {{ q.question }}</div>
              <div v-for="(op, oi) in q.options || []" :key="oi" class="question-option">{{ op }}</div>
              <div class="question-answer">答案：{{ q.answer }}</div>
            </div>
          </template>
          <span v-else class="text-muted">（无题目）</span>

          <div v-if="vocabTtsSummary" class="page-desc" style="margin-top: 8px">
            词汇音频：{{ vocabTtsSummary.ok }} / {{ vocabTtsSummary.total }} 生成成功
            <template v-if="vocabTtsSummary.failed > 0">，{{ vocabTtsSummary.failed }} 个缺失</template>
          </div>
        </template>
      </el-card>

      <!-- 说话人标注 -->
      <el-card v-if="diag?.speaker_annotated" shadow="never" class="card">
        <template #header>
          <div class="card-header-row">
            <span class="card-title">说话人标注</span>
            <el-button type="primary" size="small" :loading="adopting" @click="handleAdopt">
              采用为正文
            </el-button>
          </div>
        </template>
        <div class="pre">{{ diag.speaker_annotated }}</div>
        <p class="page-desc">「采用」会将该标注文本回写为材料正文（不自动重处理，可另行重处理）。</p>
      </el-card>
      </template>
  </div>
</template>

<script setup lang="ts">
import { Back } from '@element-plus/icons-vue'
import { useAdminMaterialRecordDiag, useAdoptSpeakerAnnotation } from '~/composables/admin'
import { derivePipelineFlow } from '~/utils/pipelineFlow'
import { layoutFlow } from '~/utils/flowLayout'
import PipelineFlowChart from '~/components/admin/records/PipelineFlowChart.vue'
import type { AdminMaterialRecordDiag } from '#shared/types/adminMaterialRecord'

definePageMeta({ layout: 'admin', title: '上传任务诊断' })

const route = useRoute()
const id = Number(route.params.id)

const diag = ref<AdminMaterialRecordDiag | null>(null)
const loadError = ref('')
const { isLoading: loading, execute: diagExecute } = useAdminMaterialRecordDiag()
const { isLoading: adopting, execute: adoptExecute } = useAdoptSpeakerAnnotation()

function goBack() {
  navigateTo(`/admin/material/records`)
}

const statusText = computed(() => {
  const s = diag.value?.status
  if (s === 'success') return '成功'
  if (s === 'failed') return '失败'
  return '处理中'
})

// ---------- 流水线流程图（SVG：垂直主链 + 菱形判断 + 分支箭头 + 泳道 + 起终点） ----------
const diagram = computed(() =>
  layoutFlow(derivePipelineFlow(diag.value?.pipeline_snapshot ?? null, diag.value?.status), diag.value?.status),
)

// ---------- DeepSeek 生成内容（来自快照 ai_content / vocab_tts） ----------
interface AiStageDetail {
  translation?: string
  vocabulary?: Array<{ word: string; phonetic?: string; meaning?: string }>
  questions?: Array<{ question: string; options?: string[]; answer?: string }>
  vocabCount?: number
  questionCount?: number
}
const aiContent = computed<AiStageDetail | null>(() => {
  const s = diag.value?.pipeline_snapshot?.stages.find((x) => x.name === 'ai_content' && x.ok)
  const d = s?.detail as AiStageDetail | undefined
  if (!d || (!d.translation && !(d.vocabulary && d.vocabulary.length))) return null
  return d
})
const vocabTtsDetail = computed(() => {
  const d = diag.value?.pipeline_snapshot?.stages.find((x) => x.name === 'vocab_tts')?.detail as
    | { total?: number; ok?: number; failed?: number; items?: Array<{ word: string; audio: boolean }> }
    | undefined
  return d
})
const vocabTtsSummary = computed(() =>
  vocabTtsDetail.value ? { total: vocabTtsDetail.value.total ?? 0, ok: vocabTtsDetail.value.ok ?? 0, failed: vocabTtsDetail.value.failed ?? 0 } : null,
)
function vocabAudioState(word: string): 'ok' | 'missing' | '' {
  const item = vocabTtsDetail.value?.items?.find((x) => x.word === word)
  if (!item) return ''
  return item.audio ? 'ok' : 'missing'
}

function formatDate(v?: string) {
  if (!v) return '-'
  const d = new Date(v)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

async function load() {
  if (!id || isNaN(id)) {
    loadError.value = '无效的记录 ID'
    return
  }
  const res = await diagExecute(id)
  if (res?.code === 200 && res.data) {
    diag.value = res.data
  } else if (res?.code === 404) {
    loadError.value = res.message || '记录不存在'
  }
}

async function handleAdopt() {
  if (!id) return
  const res = await adoptExecute(id)
  if (res?.code === 200) {
    toastSuccess('已采用')
  }
}

onMounted(load)
</script>

<style scoped>
.diag-page {
  width: 100%;
}
.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 20px;
}
.page-header__left {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}
.page-title {
  font-size: 20px;
  font-weight: 700;
  color: var(--text-1);
  margin-bottom: 6px;
}
.page-desc {
  font-size: 13px;
  color: var(--text-3);
  margin-top: 4px;
}
.card {
  margin-bottom: 16px;
}
.card-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-1);
}
.card-header-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.pre {
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 13px;
  line-height: 1.6;
  color: var(--text-2);
}
.error-text {
  color: var(--el-color-danger);
}
.audio-badge {
  margin-left: 4px;
}
.question-item {
  margin-bottom: 10px;
  font-size: 13px;
  color: var(--text-2);
}
.question-text {
  font-weight: 600;
}
.question-option {
  padding-left: 14px;
  color: var(--text-3);
}
.question-answer {
  padding-left: 14px;
  color: var(--el-color-success);
  font-weight: 600;
}
.sub-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-2);
  margin: 12px 0 6px;
}
.vocab-list {
  margin: 0;
  padding-left: 18px;
  font-size: 13px;
  color: var(--text-2);
  line-height: 1.8;
}
.text-muted {
  color: var(--text-4);
  font-size: 13px;
}
</style>