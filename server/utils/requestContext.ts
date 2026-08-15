// server/utils/requestContext.ts
// 请求级异步上下文（AsyncLocalStorage）：
// 在任务流水线等「脱离 HTTP 生命周期」的执行边界，把触发请求的 requestId 带入执行链，
// 使流水线内所有云服务埋点（cloud_service_call_log）自动携带 requestId，
// 实现「用户请求 ↔ 上传任务 ↔ 云服务调用」一键回溯，无需逐调用点手动传参。
//
// 使用方式：
//   requestContext.run({ requestId: event.context.requestId ?? null }, () => pipeline())
// 流水线内部（任意深度）经 getCurrentRequestId() 读取。
// 非请求上下文（启动/定时器）未 run 时 getCurrentRequestId() 返回 null，埋点列留空，语义安全。
import { AsyncLocalStorage } from 'node:async_hooks'

export interface RequestContext {
  requestId: string | null
}

export const requestContext = new AsyncLocalStorage<RequestContext>()

/** 读取当前异步上下文中的 requestId（无上下文或非请求上下文返回 null） */
export function getCurrentRequestId(): string | null {
  return requestContext.getStore()?.requestId ?? null
}
