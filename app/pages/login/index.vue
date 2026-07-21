<template>
  <div class="login-page">
    <div class="login-page__card">
      <h2 class="login-page__title">Nuxt4 Demo</h2>
      <el-tabs v-model="activeName" class="login-page__tabs">
        <!-- ========== 登录 ========== -->
        <el-tab-pane label="登录" name="login">
          <el-form
            ref="loginFormRef"
            :model="loginForm"
            :rules="loginRules"
            label-width="80px"
            status-icon
          >
            <el-form-item label="账号" prop="account">
              <el-input v-model="loginForm.account" placeholder="请输入账号" />
            </el-form-item>
            <el-form-item label="密码" prop="password">
              <el-input
                v-model="loginForm.password"
                type="password"
                placeholder="请输入密码"
                show-password
              />
            </el-form-item>
            <el-form-item>
              <el-button
                type="primary"
                native-type="button"
                class="login-page__submit"
                :loading="userToLogin.isLoading.value"
                @click="handleLogin"
              >
                登录
              </el-button>
              <el-button
                type="primary"
                native-type="button"
                class="login-page__submit"
                @click="resetForm(loginFormRef)"
              >
                重置
              </el-button>
            </el-form-item>
          </el-form>
        </el-tab-pane>

        <!-- ========== 注册 ========== -->
        <el-tab-pane label="注册" name="register">
          <el-form
            ref="registerFormRef"
            :model="registerForm"
            :rules="registerRules"
            label-width="80px"
            status-icon
          >
            <el-form-item label="账号" prop="account">
              <el-input v-model="registerForm.account" placeholder="纯数字，8~20 位" />
            </el-form-item>
            <el-form-item label="昵称" prop="nickname">
              <el-input v-model="registerForm.nickname" placeholder="选填，最多 25 个字符" />
            </el-form-item>
            <el-form-item label="邮箱" prop="email">
              <el-input v-model="registerForm.email" placeholder="选填" />
            </el-form-item>
            <el-form-item label="密码" prop="password1">
              <el-input
                v-model="registerForm.password1"
                type="password"
                placeholder="8~25 位，含两类字符"
                show-password
              />
            </el-form-item>
            <el-form-item label="确认密码" prop="password2">
              <el-input
                v-model="registerForm.password2"
                type="password"
                placeholder="请再次输入密码"
                show-password
              />
            </el-form-item>
            <el-form-item>
              <el-button
                type="primary"
                native-type="button"
                class="login-page__submit"
                :loading="userToRegister.isLoading.value"
                @click="handleRegister"
              >
                注册
              </el-button>
              <el-button
                type="primary"
                native-type="button"
                class="login-page__submit"
                @click="resetForm(registerFormRef)"
              >
                重置
              </el-button>
            </el-form-item>
          </el-form>
        </el-tab-pane>
      </el-tabs>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { reactive, ref } from 'vue'
import type { FormInstance, FormRules } from 'element-plus'
import { useToLogin, useToRegister } from '~/composables/user'

useSeoMeta({
  title: '登录',
})

definePageMeta({
  title: '登录',
  hideTabBar: true,
})

const activeName = ref('login')

// ==================== 登录表单 ====================
interface LoginForm {
  account: string
  password: string
}

const loginFormRef = ref<FormInstance>()
const loginForm = reactive<LoginForm>({
  account: '',
  password: '',
})

const loginRules = reactive<FormRules<LoginForm>>({
  account: [
    { required: true, message: '请输入账号', trigger: 'blur' },
    { min: 8, max: 20, message: '账号长度需要 8~20 位', trigger: 'blur' },
    { pattern: /^\d+$/, message: '账号必须是纯数字', trigger: 'blur' },
  ],
  password: [
    { required: true, message: '请输入密码', trigger: 'blur' },
    { min: 8, max: 25, message: '密码长度需要 8~25 位', trigger: 'blur' },
    {
      validator: (_rule, value, callback) => {
        let categories = 0
        if (/[a-zA-Z]/.test(value)) categories++
        if (/\d/.test(value)) categories++
        if (/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?`~]/.test(value)) categories++
        if (categories < 2) {
          callback(new Error('密码需包含数字、字母、特殊符号中的至少两类'))
        } else {
          callback()
        }
      },
      trigger: 'blur',
    },
  ],
})

// ==================== 注册表单 ====================
interface RegisterForm {
  account: string
  nickname: string
  email: string
  password1: string
  password2: string
}

const registerFormRef = ref<FormInstance>()
const registerForm = reactive<RegisterForm>({
  account: '',
  nickname: '',
  email: '',
  password1: '',
  password2: '',
})

const registerRules = reactive<FormRules<RegisterForm>>({
  account: [
    { required: true, message: '请输入账号', trigger: 'blur' },
    { min: 8, max: 20, message: '账号长度需要 8~20 位', trigger: 'blur' },
    { pattern: /^\d+$/, message: '账号必须是纯数字', trigger: 'blur' },
  ],
  nickname: [{ max: 25, message: '昵称最多 25 个字符', trigger: 'blur' }],
  email: [
    {
      validator: (_rule, value, callback) => {
        if (!value) return callback()
        const emailReg = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
        if (!emailReg.test(value)) {
          callback(new Error('邮箱格式不正确'))
        } else {
          callback()
        }
      },
      trigger: 'blur',
    },
  ],
  password1: [
    { required: true, message: '请输入密码', trigger: 'blur' },
    { min: 8, max: 25, message: '密码长度需要 8~25 位', trigger: 'blur' },
    {
      validator: (_rule, value, callback) => {
        let categories = 0
        if (/[a-zA-Z]/.test(value)) categories++
        if (/\d/.test(value)) categories++
        if (/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?`~]/.test(value)) categories++
        if (categories < 2) {
          callback(new Error('密码需包含数字、字母、特殊符号中的至少两类'))
        } else {
          if (registerForm.password2) {
            registerFormRef.value?.validateField('password2')
          }
          callback()
        }
      },
      trigger: 'blur',
    },
  ],
  password2: [
    { required: true, message: '请确认密码', trigger: 'blur' },
    {
      validator: (_rule, value, callback) => {
        if (value !== registerForm.password1) {
          callback(new Error('两次输入的密码不一致'))
        } else {
          callback()
        }
      },
      trigger: 'blur',
    },
  ],
})

const resetForm = (formEl: FormInstance | undefined) => {
  if (!formEl) return
  formEl.resetFields()
}
const userToLogin = useToLogin()
// ==================== 提交（预留） ====================
async function handleLogin() {
  if (!loginFormRef.value) return
  const valid = await loginFormRef.value.validate().catch(() => false)
  if (!valid) return
  const res = await userToLogin.handleLogin(loginForm)
  if (!res || res.code !== 200) return
  await navigateTo('/')
}
const userToRegister = useToRegister()
async function handleRegister() {
  if (!registerFormRef.value) return
  const valid = await registerFormRef.value.validate().catch(() => false)
  if (!valid) return
  const res = await userToRegister.execute(registerForm)
  if (res && res?.code === 200) {
    activeName.value = 'login'
  }
}
</script>

<style scoped>
.login-page {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 100vh;
  background: #f5f7fa;
}

.login-page__card {
  width: 440px;
  padding: 36px 32px 28px;
  background: #fff;
  border-radius: 8px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.06);
  min-height: 55vh;
}

.login-page__title {
  text-align: center;
  margin-bottom: 16px;
  font-size: 22px;
  color: #303133;
}

.login-page__tabs :deep(.el-tabs__header) {
  margin-bottom: 8px;
}

.login-page__tabs :deep(.el-tabs__nav-wrap::after) {
  height: 1px;
}

.login-page__submit {
  width: 45%;
  margin: 0 auto;
}

:deep(.el-tabs__nav-scroll) {
  display: flex;
  justify-content: center;
}
</style>
