<!-- app/components/EditProfileDialog.vue：编辑资料弹窗（基本资料 + 修改密码），由个人中心页控制显隐 -->
<template>
  <el-dialog
    :model-value="modelValue"
    title="编辑资料"
    width="90%"
    class="edit-profile-dialog"
    :close-on-click-modal="false"
    @update:model-value="(v: boolean) => emit('update:modelValue', v)"
  >
    <el-tabs v-model="activeTab">
      <!-- 基本资料：头像上传 + 昵称修改 -->
      <el-tab-pane label="基本资料" name="profile">
        <div class="avatar-row">
          <el-avatar :size="72" :src="user?.avatarUrl ?? undefined">
            <el-icon :size="36"><UserFilled /></el-icon>
          </el-avatar>
          <el-button size="small" :loading="avatarLoading" @click="pickAvatar">
            更换头像
          </el-button>
          <!-- 隐藏文件选择框：accept 仅作 UI 过滤，真正预校验在 handleFileChange -->
          <input
            ref="avatarInputRef"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            class="avatar-input"
            @change="handleFileChange"
          />
        </div>
        <p class="avatar-tip">支持 JPG / PNG / WebP，大小不超过 2MB</p>
        <el-form label-position="top" @submit.prevent>
          <el-form-item label="昵称">
            <el-input
              v-model="nickname"
              maxlength="25"
              show-word-limit
              placeholder="请输入昵称（1-25 字）"
              clearable
            />
          </el-form-item>
        </el-form>
        <el-button
          type="primary"
          class="submit-btn"
          :loading="profileLoading"
          @click="handleSaveProfile"
        >
          保存资料
        </el-button>
      </el-tab-pane>

      <!-- 修改密码：成功后走登出跳转流程 -->
      <el-tab-pane label="修改密码" name="password">
        <el-form
          ref="pwdFormRef"
          :model="pwdForm"
          :rules="pwdRules"
          label-position="top"
          @submit.prevent
        >
          <el-form-item label="旧密码" prop="oldPassword">
            <el-input
              v-model="pwdForm.oldPassword"
              type="password"
              show-password
              placeholder="请输入旧密码"
            />
          </el-form-item>
          <el-form-item label="新密码" prop="newPassword">
            <el-input
              v-model="pwdForm.newPassword"
              type="password"
              show-password
              placeholder="8-25 位，字母/数字/特殊符号至少两类"
            />
          </el-form-item>
          <el-form-item label="确认新密码" prop="confirmPassword">
            <el-input
              v-model="pwdForm.confirmPassword"
              type="password"
              show-password
              placeholder="请再次输入新密码"
            />
          </el-form-item>
        </el-form>
        <p class="pwd-tip">修改成功后需要重新登录</p>
        <el-button
          type="primary"
          class="submit-btn"
          :loading="passwordLoading"
          @click="handleChangePassword"
        >
          确认修改
        </el-button>
      </el-tab-pane>
    </el-tabs>
  </el-dialog>
</template>

<script setup lang="ts">
import { UserFilled } from '@element-plus/icons-vue'
import type { FormInstance, FormRules } from 'element-plus'
import { useUserStore } from '~/store/useUserStore'
import { useUpdateProfile, useChangePassword, useUploadAvatar } from '~/composables/user'
import { toastError } from '~/utils/popup'
import type { PasswordChangePayload } from '#shared/types/user'

const props = defineProps<{
  modelValue: boolean
}>()
const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()

const userStore = useUserStore()
const user = computed(() => userStore.user)

const activeTab = ref('profile')

// ============== 基本资料 ==============
const nickname = ref('')

const { isLoading: profileLoading, execute: doUpdateProfile } = useUpdateProfile()
const { isLoading: avatarLoading, execute: doUploadAvatar } = useUploadAvatar()
const { isLoading: passwordLoading, execute: doChangePassword } = useChangePassword()

const avatarInputRef = ref<HTMLInputElement | null>(null)

/** 头像预校验限制：与后端约定同源（image/jpeg|png|webp 且 ≤2MB） */
const AVATAR_ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const AVATAR_MAX_SIZE = 2 * 1024 * 1024

function pickAvatar() {
  avatarInputRef.value?.click()
}

async function handleFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  // 立即清空 value：允许连续选择同一文件重试
  input.value = ''
  if (!file) return

  // 前端预校验：格式 + 大小，不合规 toast 拦截
  if (!AVATAR_ALLOWED_TYPES.includes(file.type)) {
    toastError('仅支持 JPG / PNG / WebP 格式的图片')
    return
  }
  if (file.size > AVATAR_MAX_SIZE) {
    toastError('图片大小不能超过 2MB')
    return
  }

  const formData = new FormData()
  formData.append('file', file)
  // 成功后 hook 内已把 avatarUrl 合并进 store，预览随 store 自动刷新
  await doUploadAvatar(formData)
}

async function handleSaveProfile() {
  const name = nickname.value.trim()
  if (!name || name.length > 25) {
    toastError('昵称长度需为 1-25 字')
    return
  }
  const res = await doUpdateProfile({ nickname: name })
  if (res?.code === 200) {
    emit('update:modelValue', false)
  }
}

// ============== 修改密码 ==============
const pwdFormRef = ref<FormInstance | null>(null)
const pwdForm = reactive<PasswordChangePayload>({
  oldPassword: '',
  newPassword: '',
  confirmPassword: '',
})

/** 特殊符号白名单：与 server/utils/validate.ts 的 passwordSchema 保持一致（前端不允许 import server 端文件，故内联常量） */
const PASSWORD_SPECIAL_CHARS_RE = /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?`~]/

/** 新密码强度校验：8-25 位且字母/数字/特殊符号至少两类，且不得与旧密码相同 */
function validateNewPassword(_rule: unknown, value: string, callback: (error?: Error) => void) {
  if (value.length < 8 || value.length > 25) {
    callback(new Error('新密码长度需为 8-25 位'))
    return
  }
  const typeCount = [/[a-zA-Z]/, /\d/, PASSWORD_SPECIAL_CHARS_RE].filter((re) =>
    re.test(value),
  ).length
  if (typeCount < 2) {
    callback(new Error('密码必须包含数字、字母、特殊符号中的至少两类'))
    return
  }
  if (value === pwdForm.oldPassword) {
    callback(new Error('新密码不能与旧密码相同'))
    return
  }
  // 新密码变化后，重新校验确认密码的一致性
  if (pwdForm.confirmPassword) {
    pwdFormRef.value?.validateField('confirmPassword')
  }
  callback()
}

/** 确认密码校验：必须与新密码一致 */
function validateConfirmPassword(_rule: unknown, value: string, callback: (error?: Error) => void) {
  if (value !== pwdForm.newPassword) {
    callback(new Error('两次输入的新密码不一致'))
    return
  }
  callback()
}

const pwdRules: FormRules<PasswordChangePayload> = {
  oldPassword: [{ required: true, message: '请输入旧密码', trigger: 'blur' }],
  newPassword: [
    { required: true, message: '请输入新密码', trigger: 'blur' },
    { validator: validateNewPassword, trigger: 'blur' },
  ],
  confirmPassword: [
    { required: true, message: '请再次输入新密码', trigger: 'blur' },
    { validator: validateConfirmPassword, trigger: 'blur' },
  ],
}

async function handleChangePassword() {
  // 提交前 validate 拦截：校验不通过不发请求
  const valid = await pwdFormRef.value?.validate().catch(() => false)
  if (!valid) return

  const res = await doChangePassword({ ...pwdForm })
  if (res?.code === 200) {
    // 成功时后端已清 token cookie：关闭弹窗并执行登出跳转（对齐个人中心登出模式）
    emit('update:modelValue', false)
    userStore.clearUser()
    // 清空 useAsyncData 缓存：防止登录态 payload 串到游客态
    clearNuxtData()
    navigateTo('/login')
  }
}

// 每次打开弹窗：用 store 当前昵称初始化输入框，并重置密码表单
watch(
  () => props.modelValue,
  (v) => {
    if (v) {
      nickname.value = user.value?.nickname ?? ''
      pwdForm.oldPassword = ''
      pwdForm.newPassword = ''
      pwdForm.confirmPassword = ''
      pwdFormRef.value?.clearValidate()
      activeTab.value = 'profile'
    }
  },
)
</script>

<!-- el-dialog 挂载在 body 下，宽度约束需用非 scoped 样式 -->
<style>
.edit-profile-dialog {
  max-width: 400px;
  border-radius: var(--r-xl);
}
</style>

<style scoped>
.avatar-row {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 8px;
}

.avatar-input {
  display: none;
}

.avatar-tip {
  font-size: 12px;
  color: var(--text-3);
  margin: 0 0 16px;
}

.pwd-tip {
  font-size: 12px;
  color: var(--text-3);
  margin: 0 0 12px;
}

.submit-btn {
  width: 100%;
}
</style>
