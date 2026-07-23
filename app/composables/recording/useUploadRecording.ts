import { uploadRecording } from '~/api/recording'
import type { UploadRecordingPayload, UploadRecordingResult } from '#shared/types/recording'

export const useUploadRecording = () => {
  const cfg = createResCfg<UploadRecordingPayload, UploadRecordingResult>({
    handle: uploadRecording,
    success: '录音上传成功',
    clientFail: '上传失败，请检查录音文件',
    serverFail: '服务器异常，上传失败',
    error: '网络异常，请检查网络',
  })
  return useHandleRes(cfg)
}
