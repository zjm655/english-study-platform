import type { ResPayload } from '#shared/types/request'

/**
 * 提示级别：'all' 成功+失败都弹 toast；'fail' 仅失败弹；缺省不弹（只写控制台日志）
 * 约定：写操作按需打开，读链路/心跳上报保持缺省静默（写弹读静默）
 */
export type NotifyLevel = 'all' | 'fail'

export interface MsgTips {
  success: string
  clientFail: string
  serverFail: string
  error: string
}

export interface CommonReqCfg<Payload, Res> {
  tips: MsgTips
  notify?: NotifyLevel
  handle: (payload: Payload) => Promise<ResPayload<Res>>
}

export interface FlatResCfg<Payload, Res> {
  success?: string
  clientFail?: string
  serverFail?: string
  error?: string
  notify?: NotifyLevel
  handle: (payload: Payload) => Promise<ResPayload<Res>>
}

export interface LogCfg {
  code: number
  message: string
  tips: MsgTips
  notify?: NotifyLevel
}
