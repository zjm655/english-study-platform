<!-- app/components/admin/AuditionReasonDialog.vue：审核门禁试听——填理由弹窗（records.vue 与 material/[id].vue 复用） -->
<template>
  <el-dialog
    :model-value="modelValue"
    :title="title"
    width="480px"
    :close-on-click-modal="false"
    @update:model-value="(v: boolean) => emit('update:modelValue', v)"
  >
    <el-alert
      type="warning"
      :closable="false"
      show-icon
      title="隐私审计提示"
      :description="description"
      class="audition-alert"
    />
    <el-form label-width="88px" class="audition-form">
      <el-form-item label="理由类别" required>
        <el-select v-model="reasonCategory" placeholder="请选择理由类别" style="width: 100%">
          <el-option v-for="c in REVIEW_REASON_CATEGORIES" :key="c" :label="c" :value="c" />
        </el-select>
      </el-form-item>
      <el-form-item label="详细理由" required>
        <el-input
          v-model="reason"
          type="textarea"
          :rows="3"
          maxlength="500"
          show-word-limit
          placeholder="请填写具体的查看理由（1-500 字）"
        />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="emit('update:modelValue', false)">取消</el-button>
      <el-button type="primary" :loading="loading" :disabled="!canConfirm" @click="handleConfirm">
        {{ confirmText }}
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { REVIEW_REASON_CATEGORIES } from '#shared/utils/permission'

const props = withDefaults(
  defineProps<{
    modelValue: boolean
    loading?: boolean
    /** 弹窗标题（默认「填写查看理由」，可供公开状态调整等场景复用） */
    title?: string
    /** 确认按钮文案（默认「确认并试听」） */
    confirmText?: string
    /** 顶部审计提示描述文案 */
    description?: string
  }>(),
  {
    loading: false,
    title: '填写查看理由',
    confirmText: '确认并试听',
    description: '查看非公开的用户材料 / 配音将记录访问者、时间与理由用于隐私审计，请勿滥用。',
  },
)
const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  confirm: [payload: { reasonCategory: string; reason: string }]
}>()

const reasonCategory = ref('')
const reason = ref('')

const canConfirm = computed(() => !!reasonCategory.value && reason.value.trim().length > 0)

// 每次打开重置表单，避免残留上次输入
watch(
  () => props.modelValue,
  (v) => {
    if (v) {
      reasonCategory.value = ''
      reason.value = ''
    }
  },
)

function handleConfirm() {
  if (!canConfirm.value) return
  emit('confirm', { reasonCategory: reasonCategory.value, reason: reason.value.trim() })
}
</script>

<style scoped>
.audition-alert {
  margin-bottom: 16px;
}

.audition-form {
  margin-top: 4px;
}
</style>
