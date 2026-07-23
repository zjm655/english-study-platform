import { putStudyTime } from '~/api/user/studyTime'
import type { CheckinStats } from '#shared/types/user'

export const useStudyTime = () => {
  const cfg = createResCfg<number, CheckinStats>({
    handle: putStudyTime,
    success: '上报成功',
    clientFail: '登录已过期',
    serverFail: '服务器异常，请稍后重试',
    error: '网络异常，请检查网络',
  })

  const { isLoading, execute } = useHandleRes(cfg)

  async function reportStudyTime(studySeconds: number) {
    const res = await execute(studySeconds)
    return res
  }

  return { isLoading, execute: reportStudyTime }
}
