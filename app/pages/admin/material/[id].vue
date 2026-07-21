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
            <el-tag v-if="unitTitle" size="small" type="info" effect="plain">{{
              unitTitle
            }}</el-tag>
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
            <el-switch v-model="form.isPublic" active-text="公开" inactive-text="私有" />
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
  </div>
</template>

<script setup lang="ts">
import { Back, Plus, Delete } from '@element-plus/icons-vue'
import { useAdminSegmentDetail, useUpdateAdminSegment } from '~/composables/admin'
import { toastSuccess, toastWarning } from '~/utils/popup'
import type { AdminVocabEditItem, AdminSegmentUpdatePayload } from '#shared/types/adminSegment'
import type { Question } from '#shared/types/unit'

definePageMeta({
  layout: 'admin',
  title: '编辑材料',
})

useSeoMeta({ title: '编辑材料 - 管理后台' })

const route = useRoute()
const segId = Number(route.params.id)

const unitTitle = ref('')
const loadError = ref('')

const form = reactive({
  title: '',
  textContent: '',
  translation: '',
  isPublic: true,
  questions: [] as Question[],
  vocabulary: [] as AdminVocabEditItem[],
})

const { isLoading: isLoadingDetail, execute: detailExecute } = useAdminSegmentDetail()
const { isLoading: isSaving, execute: updateExecute } = useUpdateAdminSegment()

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
    isPublic: form.isPublic ? 1 : 0,
  }

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
    unitTitle.value = d.unitTitle
    form.title = d.title
    form.textContent = d.textContent
    form.translation = d.translation ?? ''
    form.isPublic = d.isPublic === 1
    form.questions = d.questions.map((q) => ({
      question: q.question,
      options: [...q.options],
      answer: q.answer,
    }))
    form.vocabulary = d.vocabulary.map((v) => ({ ...v }))
  } else if (res?.code === 404) {
    loadError.value = res.message || '材料不存在或已删除'
  }
}

onMounted(() => {
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

.edit-card {
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
