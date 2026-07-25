<template>
  <div class="login-page">
    <div class="login-page__split">
      <!-- 左：品牌面板（桌面显示，移动端收起） -->
      <aside class="brand-panel">
        <div class="brand-panel__inner">
          <h1 class="brand-panel__name">英语学习平台</h1>
          <p class="brand-panel__slogan">盲听 · 学习 · 配音 · 影子跟读</p>
          <p class="brand-panel__desc">四阶段沉浸式训练，逐段攻克听、说、读，让开口成为习惯。</p>
          <ul class="brand-panel__features">
            <li>🎧 精听盲听，磨练语感</li>
            <li>📖 逐句学习，攻克重点词汇</li>
            <li>🎤 配音评测，实时打分反馈</li>
            <li>🗣️ 影子跟读，纠正地道发音</li>
          </ul>
        </div>
      </aside>

      <!-- 右：表单卡 -->
      <div class="form-panel">
        <div class="form-panel__card">
          <h2 class="form-panel__brand">英语学习平台</h2>
          <el-tabs v-model="activeName" class="login-tabs">
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
                <!-- 验证码：连续密码错误达阈值后由后端要求显示 -->
                <el-form-item v-if="loginCaptchaRequired" label="验证码" prop="captchaCode">
                  <GraphicCaptcha
                    ref="loginCaptchaRef"
                    v-model:token="loginForm.captchaToken"
                    v-model:code="loginForm.captchaCode"
                  />
                </el-form-item>
                <el-form-item>
                  <div class="form-actions">
                    <el-button
                      type="primary"
                      native-type="button"
                      class="submit-btn"
                      :loading="userToLogin.isLoading.value"
                      @click="handleLogin"
                    >
                      登录
                    </el-button>
                    <el-button text native-type="button" @click="resetLogin">重置</el-button>
                  </div>
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
                <el-form-item label="验证码" prop="captchaCode">
                  <GraphicCaptcha
                    ref="registerCaptchaRef"
                    v-model:token="registerForm.captchaToken"
                    v-model:code="registerForm.captchaCode"
                  />
                </el-form-item>
                <el-form-item>
                  <div class="form-actions">
                    <el-button
                      type="primary"
                      native-type="button"
                      class="submit-btn"
                      :loading="userToRegister.isLoading.value"
                      @click="handleRegister"
                    >
                      注册
                    </el-button>
                    <el-button text native-type="button" @click="resetRegister">重置</el-button>
                  </div>
                </el-form-item>
              </el-form>
            </el-tab-pane>
          </el-tabs>
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { reactive, ref, computed } from 'vue'
import type { FormInstance, FormRules } from 'element-plus'
import { useToLogin, useToRegister } from '~/composables/user'

useSeoMeta({
  title: '登录',
  description: '登录或注册账号，开启四阶段英语听说训练。',
  // 隐私页无 SEO 价值，不让搜索引擎收录
  robots: 'noindex, nofollow',
})

definePageMeta({
  title: '登录',
  hideTabBar: true,
})

const activeName = ref('login')

/** 验证码组件对外暴露的方法 */
interface CaptchaExpose {
  refresh: () => void
}

// ==================== 登录表单 ====================
interface LoginForm {
  account: string
  password: string
  captchaToken: string
  captchaCode: string
}

const loginFormRef = ref<FormInstance>()
const loginForm = reactive<LoginForm>({
  account: '',
  password: '',
  captchaToken: '',
  captchaCode: '',
})

/** 是否已进入「需要验证码」态（后端连错达阈值返回 428 后置真） */
const loginCaptchaRequired = ref(false)
const loginCaptchaRef = ref<CaptchaExpose>()

// 登录规则：验证码规则仅在需要态下加入，避免常态登录被空验证码卡住
const loginRules = computed<FormRules<LoginForm>>(() => ({
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
  ...(loginCaptchaRequired.value
    ? { captchaCode: [{ required: true, message: '请输入图形验证码', trigger: 'blur' }] }
    : {}),
}))

// ==================== 注册表单 ====================
interface RegisterForm {
  account: string
  nickname: string
  email: string
  password1: string
  password2: string
  captchaToken: string
  captchaCode: string
}

const registerFormRef = ref<FormInstance>()
const registerForm = reactive<RegisterForm>({
  account: '',
  nickname: '',
  email: '',
  password1: '',
  password2: '',
  captchaToken: '',
  captchaCode: '',
})
const registerCaptchaRef = ref<CaptchaExpose>()

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
  captchaCode: [{ required: true, message: '请输入图形验证码', trigger: 'blur' }],
})

// ==================== 提交 ====================
const userToLogin = useToLogin()
async function handleLogin() {
  if (!loginFormRef.value) return
  const valid = await loginFormRef.value.validate().catch(() => false)
  if (!valid) return
  const res = await userToLogin.handleLogin(loginForm)
  if (res.code === 200) {
    await navigateTo('/')
    return
  }
  // 后端要求验证码：首次进入需要态则显示（组件挂载即自动拉取），已显示则刷新
  if (res.code === 428) {
    if (loginCaptchaRequired.value) {
      loginCaptchaRef.value?.refresh()
    } else {
      loginCaptchaRequired.value = true
    }
    return
  }
  // 其他失败（如密码错误）：若已显示验证码则刷新，避免复用旧答案
  if (loginCaptchaRequired.value) loginCaptchaRef.value?.refresh()
}

const userToRegister = useToRegister()
async function handleRegister() {
  if (!registerFormRef.value) return
  const valid = await registerFormRef.value.validate().catch(() => false)
  if (!valid) return
  const res = await userToRegister.execute(registerForm)
  if (res && res.code === 200) {
    activeName.value = 'login'
    return
  }
  // 注册失败（含验证码错误）：刷新验证码
  registerCaptchaRef.value?.refresh()
}

// ==================== 重置 ====================
function resetLogin() {
  loginFormRef.value?.resetFields()
  if (loginCaptchaRequired.value) loginCaptchaRef.value?.refresh()
}
function resetRegister() {
  registerFormRef.value?.resetFields()
  registerCaptchaRef.value?.refresh()
}
</script>

<style scoped>
.login-page {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 100vh;
  padding: 24px;
  background: var(--bg);
}
.login-page__split {
  display: flex;
  width: min(920px, 100%);
  min-height: 540px;
  background: var(--card);
  border-radius: var(--r-lg);
  box-shadow: var(--shadow);
  overflow: hidden;
}

/* 左：品牌面板 */
.brand-panel {
  flex: 1.05;
  display: flex;
  align-items: center;
  padding: 48px 40px;
  background: linear-gradient(135deg, var(--primary), var(--primary-dark));
  color: #fff;
}
.brand-panel__name {
  font-size: 30px;
  font-weight: 800;
  letter-spacing: 1px;
}
.brand-panel__slogan {
  margin-top: 12px;
  font-size: 15px;
  opacity: 0.9;
  letter-spacing: 2px;
}
.brand-panel__desc {
  margin-top: 20px;
  font-size: 13px;
  line-height: 1.7;
  opacity: 0.85;
}
.brand-panel__features {
  margin-top: 28px;
  list-style: none;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.brand-panel__features li {
  font-size: 14px;
  opacity: 0.95;
}

/* 右：表单 */
.form-panel {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40px 36px;
}
.form-panel__card {
  width: 100%;
  max-width: 360px;
}
.form-panel__brand {
  display: none;
  text-align: center;
  font-size: 22px;
  font-weight: 700;
  color: var(--text-1);
  margin-bottom: 18px;
}
.login-tabs :deep(.el-tabs__nav-scroll) {
  display: flex;
  justify-content: center;
}
.login-tabs :deep(.el-tabs__header) {
  margin-bottom: 20px;
}
.login-tabs :deep(.el-tabs__nav-wrap::after) {
  height: 1px;
}

.form-actions {
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 100%;
}
.submit-btn {
  width: 100%;
  margin: 0;
}

/* 移动端：收起品牌面板，单列卡片 */
@media (max-width: 768px) {
  .login-page {
    align-items: flex-start;
    padding: 32px 16px;
  }
  .login-page__split {
    flex-direction: column;
    width: 100%;
    max-width: 420px;
    min-height: auto;
    margin: 0 auto;
  }
  .brand-panel {
    display: none;
  }
  .form-panel {
    padding: 28px 22px;
  }
  .form-panel__brand {
    display: block;
  }
}
</style>
