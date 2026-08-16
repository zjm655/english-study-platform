import { randomUUID } from 'node:crypto'
import { readFormData } from 'h3'
import { validateSuccess, validateError } from '#server/utils/validate'
import { enqueueAdminMaterial, processAdminBatch } from '#server/services/adminUpload'
import { getUploadLimits, validateUploadText } from '#server/utils/uploadLimitChecker'
import { uploadWithKey, deleteObject } from '#server/utils/oss'
import { extractAudioMeta } from '#server/utils/audioMeta'
import { resolveUploadTitle } from '#server/utils/textParser'
import { useRuntimeConfig } from '#imports'
import type { AdminUploadResponse, AdminUploadItemResult } from '#shared/types/adminUpload'
import { adminUploadSchema } from '#shared/schemas/material'
import { ensurePermission } from '#server/services/permission'
import { PERMISSIONS } from '#shared/utils/permission'

export default defineEventHandler(async (event) => {
  // 纵深防御：中间件已对 /api/admin/* 做管理员门禁，此处再校验一次
  const err = ensurePermission(event, PERMISSIONS.MANAGE_MATERIALS)
  if (err) return err
  const user = event.context.user

  const formData = await readFormData(event)
  const mode = formData.get('mode') as string | null
  const unitId = formData.get('unitId') as string | null
  const voice = formData.get('voice') as string | null
  const isPublic = formData.get('isPublic') as string | null
  const nlsCheck = formData.get('nlsCheck') as string | null
  const titleMode = formData.get('titleMode') as string | null

  const parsed = adminUploadSchema.safeParse({ mode, unitId, voice, isPublic, nlsCheck, titleMode })
  if (!parsed.success) {
    return validateError(parsed.error?.issues?.[0]?.message ?? '参数校验失败', 400)
  }

  const {
    mode: validMode,
    unitId: validUnitId,
    voice: validVoice,
    isPublic: validIsPublic,
    nlsCheck: validNlsCheck,
    titleMode: validTitleMode,
  } = parsed.data
  const { oss } = useRuntimeConfig()
  const bucket = oss.bucket as string
  const userId = user.id

  let results: AdminUploadItemResult[]

  if (validMode === 'single') {
    const textContent = formData.get('textContent') as string | null
    const title = formData.get('title') as string | null
    const fileName = formData.get('fileName') as string | null
    const audio = formData.get('audio') as File | null

    const trimmedText = textContent?.trim() ?? ''

    // 文本长度校验（sys_config 动态上下限，管理员档；原硬编码 10/5000 已抽离）
    const limits = await getUploadLimits()
    const rawCheck = validateUploadText(trimmedText, limits, 'admin')
    if (!rawCheck.ok) {
      return validateError(rawCheck.message, 400)
    }

    // 标题模式解析（同步段）：manual 必须填写标题；inline 提取 # 首行并清理正文；text_filename/audio_filename 用对应文件名（去扩展名）；ai 交流水线生成
    if (validTitleMode === 'manual' && !title?.trim()) {
      return validateError('请填写标题（手动模式）', 400)
    }
    const resolved = resolveUploadTitle({
      titleMode: validTitleMode,
      title,
      fileName,
      textContent: rawCheck.text,
    })
    const resolvedText = resolved.textContent.trim()
    // 标题提取后正文可能变短，再校验一次下限（上限不会超：提取只减不增）
    const bodyCheck = validateUploadText(resolvedText, limits, 'admin')
    if (!bodyCheck.ok) {
      return validateError(bodyCheck.message, 400)
    }

    let audioBuffer: Buffer | undefined
    let audioFileName: string | undefined
    let audioOssKey: string | undefined
    if (audio && audio.size > 0) {
      // 大小前置校验：避免超大文件先烧 TTS/OSS 云费、大 Buffer 驻留队列（限制值运营可调）
      const { maxAudioSizeAdmin, maxAudioDurationAdmin } = await getUploadLimits()
      if (audio.size > maxAudioSizeAdmin) {
        return validateError(`音频大小超过限制（${maxAudioSizeAdmin / 1024 / 1024}MB）`, 400)
      }
      audioBuffer = Buffer.from(await audio.arrayBuffer())
      audioFileName = audio.name
      // 时长前置校验：超长音频不烧 STT/OSS 云费（流水线内仍有后置兼校）
      const meta = await extractAudioMeta(audioBuffer)
      if (!meta) {
        return validateError('无法解析音频信息', 400)
      }
      if (meta.duration > maxAudioDurationAdmin) {
        return validateError(`音频时长超过限制（${maxAudioDurationAdmin}s）`, 400)
      }
      // 持久化到 OSS：任务失败重处理时可复用上传音频，不再静默退回 TTS 合成
      const ext = audio.name.split('.').pop()?.toLowerCase() || 'mp3'
      audioOssKey = `audio/material/${randomUUID()}.${ext}`
      try {
        await uploadWithKey(audioBuffer, audioOssKey)
      } catch (err) {
        logger.error('[admin upload] 同步段音频上传失败:', err)
        return validateError('音频上传失败，请重试', 400)
      }
    }

    const result = await enqueueAdminMaterial({
      userId,
      unitId: validUnitId,
      textContent: resolvedText,
      title: resolved.title,
      titleMode: validTitleMode,
      voice: validVoice,
      isPublic: validIsPublic,
      // 仅 single 场景携带；batch 无音频，不传（保持 0）
      nlsCheck: validNlsCheck === 1,
      bucket,
      audioBuffer,
      audioFileName,
      audioOssKey,
      requestId: (event.context.requestId as string) ?? null,
    })
    if (!result.success && audioOssKey) {
      // 建记录失败：best-effort 清理已持久化的音频孤儿（音频归记录所有，记录没了对象也要清）
      void deleteObject(audioOssKey)
    }
    results = [{ ...result, index: 0, ...(resolved.notice ? { notice: resolved.notice } : {}) }]
  } else {
    // batch
    const files = formData.getAll('files') as File[]
    if (!files.length) {
      return validateError('请上传至少一个 txt 文件', 400)
    }
    if (files.length > 20) {
      return validateError('单次批量上传不能超过 20 个文件', 400)
    }

    const txtFiles: Array<{ name: string; content: string }> = []
    for (const file of files) {
      if (!file.name.endsWith('.txt')) continue
      const content = await file.text()
      txtFiles.push({ name: file.name, content })
    }

    if (!txtFiles.length) {
      return validateError('未找到 txt 文件', 400)
    }

    results = await processAdminBatch({
      userId,
      unitId: validUnitId,
      voice: validVoice,
      isPublic: validIsPublic,
      titleMode: validTitleMode,
      bucket,
      files: txtFiles,
      requestId: (event.context.requestId as string) ?? null,
    })
  }

  // 异步入队回执：success=已入队（实际处理结果看「上传记录」页），failed=同步校验被拒
  const successCount = results.filter((r) => r.success).length
  const response: AdminUploadResponse = {
    results,
    summary: {
      total: results.length,
      success: successCount,
      failed: results.length - successCount,
    },
  }
  return validateSuccess(response, `已入队 ${successCount} 条，处理进度请在上传记录页查看`)
})
