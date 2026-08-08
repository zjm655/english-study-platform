<template>
  <div class="segment-edit-page">
    <!-- 页眉：返回 + 标题 + 保存 -->
    <div class="page-header">
      <div class="page-header__left">
        <el-button text @click="goBack">
          <el-icon><Back /></el-icon>
          <span>返回列表</span>
        </el-button>
        <div>
          <h2 class="page-title">编辑材料</h2>
          <p class="page-desc">
            <el-select
              v-model="form.unitId"
              size="small"
              filterable
              placeholder="所属单元"
              class="unit-select"
            >
              <el-option
                v-for="u in unitOptions"
                :key="u.id"
                :label="u.id === 0 ? `${u.title}（系统保留）` : u.title"
                :value="u.id"
              />
            </el-select>
            <span class="page-desc__note">仅保存文本字段，不会重新生成音频与 AI 内容。</span>
          </p>
        </div>
      </div>
      <el-button type="primary" :loading="isSaving" @click="handleSave">保存修改</el-button>
    </div>

    <!-- 加载失败 -->
    <el-empty v-if="loadError" :description="loadError">
      <el-button @click="goBack">返回列表</el-button>
    </el-empty>

    <template v-else>
      <!-- 基础信息 -->
      <el-card v-loading="isLoadingDetail" class="edit-card" shadow="never">
        <template #header><span class="card-title">基础信息</span></template>
        <el-form label-width="90px">
          <el-form-item label="标题">
            <el-input v-model="form.title" maxlength="100" show-word-limit style="width: 480px" />
          </el-form-item>
          <el-form-item label="是否公开">
            <!-- 未锁定：普通开关，随批量保存 -->
            <el-switch
              v-if="!visibilityLocked"
              v-model="form.isPublic"
              active-text="公开"
              inactive-text="私有"
            />
            <!-- 受限材料（非公开用户材料）+ 有审核权限：切换触发填理由门禁 -->
            <div v-else-if="can(PERMISSIONS.REVIEW)" class="visibility-gated">
              <el-switch
                v-model="form.isPublic"
                :before-change="beforeVisibilityChange"
                active-text="公开"
                inactive-text="私有"
              />
              <span class="visibility-gated__tip">
                非公开用户材料——调整公开状态需填写理由，操作将记录访问者/时间/理由用于审计。
              </span>
            </div>
            <!-- 受限材料 + 无审核权限：只读 -->
            <el-tag v-else type="info" size="small">私有（用户材料，需审核权限调整）</el-tag>
          </el-form-item>
          <el-form-item label="NLS 校对">
            <el-tooltip
              v-if="nlsCheck === 1"
              content="该材料上传时开启了 NLS 语音校对（识别+相似度核验），可在上传记录中追溯"
              placement="top"
            >
              <el-tag type="warning" size="small">已启用语音校对</el-tag>
            </el-tooltip>
            <span v-else class="text-muted">未启用</span>
          </el-form-item>
          <el-form-item label="英文原文">
            <el-input
              v-model="form.textContent"
              type="textarea"
              :rows="7"
              maxlength="5000"
              show-word-limit
              placeholder="材料英文原文（10-5000 字符）"
            />
          </el-form-item>
          <el-form-item label="中文翻译">
            <el-input
              v-model="form.translation"
              type="textarea"
              :rows="5"
              maxlength="5000"
              show-word-limit
              placeholder="材料中文翻译（可留空）"
            />
          </el-form-item>
          <el-form-item v-if="audioUrl || audioLocked" label="音频试听">
            <div class="audition-field">
              <AudioPlayer v-if="audioUrl" :src="audioUrl" :duration="audioDuration ?? undefined" />
              <template v-else-if="can(PERMISSIONS.REVIEW)">
                <span class="audition-field__tip">
                  非公开用户材料——填写理由后方可试听，操作将记录访问者/时间/理由用于隐私审计。
                </span>
                <el-button type="primary" plain @click="auditionVisible = true">
                  <el-icon><Unlock /></el-icon><span>填理由解锁试听</span>
                </el-button>
              </template>
              <span v-else class="audition-field__tip">
                非公开用户材料暂不支持试听（需审核权限）。
              </span>
            </div>
          </el-form-item>
        </el-form>
      </el-card>

      <!-- 重点词汇 -->
      <el-card class="edit-card" shadow="never">
        <template #header>
          <div class="card-header-row">
            <span class="card-title">重点词汇（{{ form.vocabulary.length }}）</span>
            <el-button size="small" @click="addVocab">
              <el-icon><Plus /></el-icon><span>添加词汇</span>
            </el-button>
          </div>
        </template>
        <el-table :data="form.vocabulary" border size="small">
          <el-table-column label="单词" min-width="110">
            <template #default="{ row }"
              ><el-input v-model="row.word" placeholder="word"
            /></template>
          </el-table-column>
          <el-table-column label="音标" min-width="110">
            <template #default="{ row }"
              ><el-input v-model="row.phonetic" placeholder="/.../"
            /></template>
          </el-table-column>
          <el-table-column label="释义" min-width="150">
            <template #default="{ row }"
              ><el-input v-model="row.meaning" placeholder="释义"
            /></template>
          </el-table-column>
          <el-table-column label="词形变化" min-width="120">
            <template #default="{ row }"
              ><el-input v-model="row.forms" placeholder="复数/过去式等"
            /></template>
          </el-table-column>
          <el-table-column label="例句" min-width="180">
            <template #default="{ row }"
              ><el-input v-model="row.exampleSentence" placeholder="英文例句"
            /></template>
          </el-table-column>
          <el-table-column label="例句翻译" min-width="180">
            <template #default="{ row }"
              ><el-input v-model="row.exampleTranslation" placeholder="例句翻译"
            /></template>
          </el-table-column>
          <el-table-column label="操作" width="70" align="center" fixed="right">
            <template #default="{ $index }">
              <el-button type="danger" link size="small" @click="removeVocab($index)"
                >删除</el-button
              >
            </template>
          </el-table-column>
          <template #empty>
            <el-empty description="暂无词汇，点击「添加词汇」新增" :image-size="60" />
          </template>
        </el-table>
      </el-card>

      <!-- 理解题 -->
      <el-card class="edit-card" shadow="never">
        <template #header>
          <div class="card-header-row">
            <span class="card-title">理解题（{{ form.questions.length }}）</span>
            <el-button size="small" @click="addQuestion">
              <el-icon><Plus /></el-icon><span>添加题目</span>
            </el-button>
          </div>
        </template>

        <el-empty
          v-if="form.questions.length === 0"
          description="暂无题目（该材料将作为无题目材料）"
          :image-size="60"
        />

        <div v-for="(q, qi) in form.questions" :key="qi" class="question-block">
          <div class="question-block__head">
            <span class="question-block__index">第 {{ qi + 1 }} 题</span>
            <el-button type="danger" link size="small" @click="removeQuestion(qi)"
              >删除本题</el-button
            >
          </div>
          <el-input v-model="q.question" placeholder="题干" class="question-block__stem" />
          <div class="question-block__options">
            <div v-for="(_opt, oi) in q.options" :key="oi" class="option-row">
              <el-input
                v-model="q.options[oi]"
                :placeholder="`选项 ${oi + 1}`"
                class="option-row__input"
              />
              <el-button
                type="danger"
                link
                :disabled="q.options.length <= 1"
                @click="removeOption(q, oi)"
              >
                <el-icon><Delete /></el-icon>
              </el-button>
            </div>
            <el-button size="small" text @click="addOption(q)">
              <el-icon><Plus /></el-icon><span>添加选项</span>
            </el-button>
          </div>
          <div class="question-block__answer">
            <span class="question-block__answer-label">正确答案：</span>
            <el-select v-model="q.answer" placeholder="从选项中选择" style="width: 320px">
              <el-option v-for="(opt, oi) in validOptions(q)" :key="oi" :label="opt" :value="opt" />
            </el-select>
          </div>
        </div>
      </el-card>

      <!-- 底部保存 -->
      <div class="bottom-bar">
        <el-button @click="goBack">取消</el-button>
        <el-button type="primary" :loading="isSaving" @click="handleSave">保存修改</el-button>
      </div>
    </template>

    <!-- 审核门禁：填理由试听弹窗（与 records 页复用同一组件） -->
    <AuditionReasonDialog
      v-model="auditionVisible"
      :loading="isAuditioning"
      @confirm="handleAudition"
    />

    <!-- 审核门禁：调整公开状态填理由弹窗（复用同组件，传入公开状态相关文案） -->
    <AuditionReasonDialog
      v-model="visibilityDialogVisible"
      :loading="isVisibilitySaving"
      title="调整材料公开状态"
      confirm-text="确认并调整"
      description="将非公开用户材料设为公开后将对外可见，操作将记录访问者、时间与理由用于审计，请谨慎操作。"
      @confirm="handleVisibilityConfirm"
    />
  </div>
</template>

<script setup lang="ts">
import { Back, Plus, Delete, Unlock } from '@element-plus/icons-vue'
import {
  useAdminSegmentDetail,
  useUpdateAdminSegment,
  useAuditionSegment,
  useUpdateSegmentVisibility,
} from '~/composables/admin'
import { usePermission } from '~/composables/user'
import { getUnits } from '~/api/unit/units'
import AuditionReasonDialog from '~/components/admin/AuditionReasonDialog.vue'
import { toastSuccess, toastWarning } from '~/utils/popup'
import { PERMISSIONS } from '#shared/utils/permission'
import type { AdminVocabEditItem, AdminSegmentUpdatePayload } from '#shared/types/adminSegment'
import type { Question, UnitWithProgress } from '#shared/types/unit'

definePageMeta({
  layout: 'admin',
  title: '编辑材料',
})

useSeoMeta({ title: '编辑材料 - 管理后台' })

const route = useRoute()
const segId = Number(route.params.id)

const loadError = ref('')

// 音频门禁试听状态（契约增量字段，仅展示层）
const audioUrl = ref<string | null>(null)
const audioDuration = ref<number | null>(null)
const audioLocked = ref(false)
const auditionVisible = ref(false)
// 公开状态门禁（受限材料 = 非公开的用户材料，调整需 REVIEW 权限 + 填理由）
const visibilityLocked = ref(false)
const visibilityDialogVisible = ref(false)

const form = reactive({
  title: '',
  textContent: '',
  translation: '',
  isPublic: true,
  unitId: 0,
  questions: [] as Question[],
  vocabulary: [] as AdminVocabEditItem[],
})

// NLS 语音校对标记（材料详情只读展示，非可编辑字段）
const nlsCheck = ref(0)

// 单元下拉数据（所属单元变更；无 id=0 行时手动前置自定义单元占位）
const units = ref<UnitWithProgress[]>([])
const unitOptions = computed(() => {
  const hasCustom = units.value.some((u) => u.id === 0)
  return hasCustom
    ? units.value
    : [{ id: 0, title: '自定义单元' } as UnitWithProgress, ...units.value]
})

async function loadUnits() {
  const res = await getUnits()
  if (res?.code === 200 && res.data) {
    units.value = res.data
  }
}

const { can } = usePermission()

const { isLoading: isLoadingDetail, execute: detailExecute } = useAdminSegmentDetail()
const { isLoading: isSaving, execute: updateExecute } = useUpdateAdminSegment()
const { isLoading: isAuditioning, execute: auditionExecute } = useAuditionSegment()
const { isLoading: isVisibilitySaving, execute: visibilityExecute } = useUpdateSegmentVisibility()

// ===== 词汇编辑 =====
function addVocab() {
  form.vocabulary.push({
    word: '',
    meaning: '',
    forms: null,
    phonetic: null,
    exampleSentence: null,
    exampleTranslation: null,
  })
}
function removeVocab(index: number) {
  form.vocabulary.splice(index, 1)
}

// ===== 题目编辑 =====
function addQuestion() {
  form.questions.push({ question: '', options: ['', ''], answer: '' })
}
function removeQuestion(index: number) {
  form.questions.splice(index, 1)
}
function addOption(q: Question) {
  q.options.push('')
}
function removeOption(q: Question, index: number) {
  const removed = q.options[index]
  q.options.splice(index, 1)
  // 若删除的正是已选答案，清空答案避免残留无效值
  if (q.answer === removed) q.answer = ''
}
function validOptions(q: Question) {
  return q.options.map((o) => o.trim()).filter(Boolean)
}

// ===== 保存 =====
async function handleSave() {
  if (!form.title.trim()) return toastWarning('标题不能为空')
  if (form.textContent.trim().length < 10) return toastWarning('材料文本不能少于 10 个字符')

  for (const v of form.vocabulary) {
    if (!v.word.trim() || !v.meaning.trim()) return toastWarning('词汇的单词与释义不能为空')
  }

  for (const q of form.questions) {
    if (!q.question.trim()) return toastWarning('题干不能为空')
    const opts = q.options.map((o) => o.trim()).filter(Boolean)
    if (opts.length === 0) return toastWarning('每题至少需要一个非空选项')
    if (!q.answer || !opts.includes(q.answer)) return toastWarning('正确答案必须是某个选项')
  }

  const payload: AdminSegmentUpdatePayload = {
    title: form.title.trim(),
    textContent: form.textContent.trim(),
    translation: form.translation.trim() || null,
    questions: form.questions.map((q) => ({
      question: q.question.trim(),
      options: q.options.map((o) => o.trim()).filter(Boolean),
      answer: q.answer,
    })),
    vocabulary: form.vocabulary.map((v) => ({
      id: v.id,
      word: v.word.trim(),
      forms: v.forms?.trim() || null,
      phonetic: v.phonetic?.trim() || null,
      meaning: v.meaning.trim(),
      exampleSentence: v.exampleSentence?.trim() || null,
      exampleTranslation: v.exampleTranslation?.trim() || null,
    })),
  }
  // 受限材料（非公开用户材料）的公开状态只走门禁端点，批量保存不提交 isPublic（服务端亦兜底）
  if (!visibilityLocked.value) {
    payload.isPublic = form.isPublic ? 1 : 0
  }
  // 所属单元变更（0=自定义单元合法；服务端校验目标单元存在）
  payload.unitId = form.unitId

  const res = await updateExecute({ id: segId, data: payload })
  if (res?.code === 200) {
    toastSuccess('保存成功（仅保存文本，不会重新生成音频）')
  }
}

function goBack() {
  navigateTo('/admin/material')
}

// ===== 加载详情 =====
async function loadDetail() {
  if (!segId || isNaN(segId)) {
    loadError.value = '无效的材料 ID'
    return
  }
  const res = await detailExecute(segId)
  if (res?.code === 200 && res.data) {
    const d = res.data
    form.title = d.title
    form.textContent = d.textContent
    form.translation = d.translation ?? ''
    form.isPublic = d.isPublic === 1
    form.unitId = d.unitId
    form.questions = d.questions.map((q) => ({
      question: q.question,
      options: [...q.options],
      answer: q.answer,
    }))
    form.vocabulary = d.vocabulary.map((v) => ({ ...v }))
    audioUrl.value = d.audioUrl ?? null
    audioDuration.value = d.duration ?? null
    audioLocked.value = d.audioLocked ?? false
    visibilityLocked.value = d.visibilityLocked ?? false
    nlsCheck.value = d.nlsCheck ?? 0
  } else if (res?.code === 404) {
    loadError.value = res.message || '材料不存在或已删除'
  }
}

// ===== 审核门禁试听：填理由 + 留痕落库成功后才返签名 URL =====
async function handleAudition(payload: { reasonCategory: string; reason: string }) {
  const res = await auditionExecute({ id: segId, payload })
  if (res?.code === 200 && res.data) {
    audioUrl.value = res.data.audioUrl
    audioDuration.value = res.data.duration
    audioLocked.value = false
    auditionVisible.value = false
  }
}

// ===== 审核门禁：调整受限材料公开状态（填理由 + 留痕成功后才变更）=====
// 受限材料恒为私有，切换目标恒为「公开」；before-change 阻止即时切换、先弹窗填理由。
function beforeVisibilityChange() {
  visibilityDialogVisible.value = true
  return false
}
async function handleVisibilityConfirm(payload: { reasonCategory: string; reason: string }) {
  const targetIsPublic = form.isPublic ? 0 : 1
  const res = await visibilityExecute({
    id: segId,
    payload: { isPublic: targetIsPublic, ...payload },
  })
  if (res?.code === 200 && res.data) {
    form.isPublic = res.data.isPublic === 1
    visibilityLocked.value = false
    visibilityDialogVisible.value = false
    toastSuccess('材料公开状态已更新')
  }
}

onMounted(() => {
  loadUnits()
  loadDetail()
})
</script>

<style scoped>
.segment-edit-page {
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
  font-size: 22px;
  font-weight: 700;
  color: var(--text-1);
  margin-bottom: 6px;
}

.page-desc {
  display: flex;
  align-items: center;
  gap: 8px;
}

.page-desc__note {
  font-size: 13px;
  color: var(--text-3);
}

.unit-select {
  width: 200px;
}

.edit-card {
  margin-bottom: 16px;
}

.card-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-1);
}

.audition-field {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
  align-items: flex-start;
}

.audition-field__tip {
  font-size: 13px;
  color: var(--text-3);
}

.visibility-gated {
  display: flex;
  flex-direction: column;
  gap: 6px;
  align-items: flex-start;
}

.visibility-gated__tip {
  font-size: 12px;
  color: var(--text-3);
}

.card-header-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.question-block {
  border: 1px solid var(--border-ll);
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 14px;
  background: var(--card);
}

.question-block__head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}

.question-block__index {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-2);
}

.question-block__stem {
  margin-bottom: 10px;
}

.question-block__options {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 12px;
}

.option-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.option-row__input {
  max-width: 480px;
}

.question-block__answer {
  display: flex;
  align-items: center;
  gap: 8px;
}

.question-block__answer-label {
  font-size: 14px;
  color: var(--text-2);
}

.bottom-bar {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  padding: 8px 0 24px;
}
</style>
