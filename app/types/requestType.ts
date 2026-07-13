import type { ResPayload } from '#shared/types/request'

export interface MsgTips {
  success: string
  clientFail: string
  serverFail: string
  error: string
}

export interface CommonReqCfg<Payload, Res> {
  tips: MsgTips
  handle: (payload: Payload) => Promise<ResPayload<Res>>
}

export interface FlatResCfg<Payload, Res> {
  success?: string
  clientFail?: string
  serverFail?: string
  error?: string
  handle: (payload: Payload) => Promise<ResPayload<Res>>
}

export interface LogCfg {
  code: number
  message: string
  tips: MsgTips
}