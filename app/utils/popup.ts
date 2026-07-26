/**
 * 弹窗工具类
 * 基于 Element Plus 的 ElMessage 和 ElMessageBox 封装
 * 提供统一的弹窗 API，支持成功、错误、警告、提示、确认等场景
 */

import { ElMessage, ElMessageBox } from 'element-plus'
import type { ElMessageBoxOptions } from 'element-plus'

// ============== 消息提示 (ElMessage) ==============

/**
 * 成功提示
 * @param message 提示内容
 * @param duration 显示时长(ms)，默认 2000
 */
export function toastSuccess(message: string, duration = 2000) {
  return ElMessage.success({ message, duration, showClose: true })
}

/**
 * 错误提示
 * @param message 提示内容
 * @param duration 显示时长(ms)，默认 3000
 */
export function toastError(message: string, duration = 3000) {
  return ElMessage.error({ message, duration, showClose: true })
}

/**
 * 警告提示
 * @param message 提示内容
 * @param duration 显示时长(ms)，默认 2500
 */
export function toastWarning(message: string, duration = 2500) {
  return ElMessage.warning({ message, duration, showClose: true })
}

/**
 * 信息提示
 * @param message 提示内容
 * @param duration 显示时长(ms)，默认 2000
 */
export function toastInfo(message: string, duration = 2000) {
  return ElMessage.info({ message, duration, showClose: true })
}

// ============== 确认弹窗 (ElMessageBox) ==============

/**
 * 确认弹窗
 * @param message 确认内容
 * @param title 标题，默认"提示"
 * @param options 可选配置
 * @returns Promise，确认时 resolve，取消时 reject
 */
export function toastConfirm(
  message: string,
  title = '提示',
  options?: Partial<ElMessageBoxOptions>,
) {
  return ElMessageBox.confirm(message, title, {
    confirmButtonText: '确定',
    cancelButtonText: '取消',
    type: 'warning',
    ...options,
  })
}

/**
 * 提示弹窗（只有确定按钮）
 * @param message 提示内容
 * @param title 标题，默认"提示"
 * @param options 可选配置
 */
export function toastAlert(
  message: string,
  title = '提示',
  options?: Partial<ElMessageBoxOptions>,
) {
  return ElMessageBox.alert(message, title, {
    confirmButtonText: '确定',
    type: 'info',
    ...options,
  })
}

/**
 * 输入弹窗
 * @param message 提示内容
 * @param title 标题，默认"请输入"
 * @param options 可选配置
 * @returns Promise，返回用户输入的内容
 */
export function toastPrompt(
  message: string,
  title = '请输入',
  options?: Partial<ElMessageBoxOptions>,
) {
  return ElMessageBox.prompt(message, title, {
    confirmButtonText: '确定',
    cancelButtonText: '取消',
    ...options,
  })
}

// ============== 加载遮罩 ==============

/**
 * 显示全屏加载遮罩
 * @param message 加载提示文字
 * @returns 关闭遮罩的函数
 */
export function toastLoading(message = '加载中...') {
  const loading = ElMessage({
    message,
    type: 'info',
    duration: 0, // 不自动关闭
    showClose: false,
  })
  return () => loading.close()
}

// ============== 通用弹窗（根据 code 自动判断类型） ==============

/**
 * 批量操作结果汇总提示（配套后端 BatchResult 部分成功语义）：
 * 全部成功 → success；存在跳过 → warning 并按原因聚合展示（id 列表随原因带出）
 */
export function toastBatchResult(result: {
  succeeded: number
  skipped: { id: number; reason: string }[]
}) {
  const { succeeded, skipped } = result
  if (skipped.length === 0) {
    return toastSuccess(`操作成功 ${succeeded} 条`)
  }
  const grouped = new Map<string, number[]>()
  for (const item of skipped) {
    const ids = grouped.get(item.reason) ?? []
    ids.push(item.id)
    grouped.set(item.reason, ids)
  }
  const detail = [...grouped.entries()]
    .map(([reason, ids]) => `${reason}（ID: ${ids.join('、')}）`)
    .join('；')
  return toastWarning(`成功 ${succeeded} 条，跳过 ${skipped.length} 条：${detail}`, 6000)
}

/**
 * 根据响应 code 自动弹出对应类型的提示
 * @param code 响应码
 * @param message 提示内容
 * @param successMsg 成功时的提示（可选，覆盖默认）
 */
export function toastByCode(code: number, message: string, successMsg?: string) {
  if (code === 200) {
    return toastSuccess(successMsg || message)
  }
  if (code === 401) {
    return toastWarning('登录已过期，请重新登录')
  }
  if (code >= 500) {
    return toastError(message || '服务器异常，请稍后重试')
  }
  return toastError(message || '操作失败')
}
