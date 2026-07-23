import { ref } from 'vue'
import type { CommonReqCfg } from '~/types/requestType'
import type { ResPayload } from '#shared/types/request'

/**
 * 判断未知值是否为 ResPayload 结构
 */
export function isResPayload<T>(val: unknown): val is ResPayload<T> {
  return (
    typeof val === 'object' && val !== null && 'code' in val && 'message' in val && 'data' in val
  )
}

/**
 * 通用请求 Composable：统一管理 loading、错误捕获、状态码日志
 *
 * @example
 * const { isLoading, execute } = useHandleRes(
 *   createResCfg({ handle: login, success: '登录成功' })
 * )
 * const res = await execute({ account: '12345678', password: 'xxx' })
 */
export const useHandleRes = <Payload, Res>(resCfg: CommonReqCfg<Payload, Res>) => {
  const isLoading = ref(false)
  let timer: ReturnType<typeof setTimeout> | null = null

  return {
    isLoading,
    execute: async (payload: Payload): Promise<ResPayload<Res>> => {
      // 防止重复提交
      if (timer !== null || isLoading.value) {
        return { code: -2, message: '请求进行中，请稍候', data: null as unknown as Res }
      }

      timer = setTimeout(() => {
        isLoading.value = true
      }, 100)

      const logCfg = {
        code: -1,
        message: '未知错误',
        tips: resCfg.tips,
      }

      try {
        const res = await resCfg.handle(payload)
        clearTimeout(timer)
        logCfg.code = res?.code ?? -1
        logCfg.message = res?.message ?? ''
        return res
      } catch (err) {
        // 区分结构化的 ResPayload 错误和普通异常
        const error: ResPayload<Res> = isResPayload<Res>(err)
          ? err
          : { code: 0, message: String(err), data: null as unknown as Res }

        logCfg.code = error?.code ?? 0
        logCfg.message = error.message
        logger.warn(error?.message || '请求错误')
        return error
      } finally {
        isLoading.value = false
        if (timer) {
          clearTimeout(timer)
          timer = null
        }
        void resolveCode(logCfg)
      }
    },
  }
}
