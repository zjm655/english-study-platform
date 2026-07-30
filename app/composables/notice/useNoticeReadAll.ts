import { readAllNotices } from '~/api/notice'

/** 全部标记已读（写弹：成功文案回退后端 message「已全部标记为已读」） */
export const useNoticeReadAll = () => {
  const cfg = createResCfg<null, { affectedRows: number }>({
    handle: readAllNotices,
    success: '',
    clientFail: '操作失败，请稍后重试',
    serverFail: '服务器异常，操作失败',
    error: '网络异常，请检查网络',
    notify: 'all',
  })
  return useHandleRes(cfg)
}
