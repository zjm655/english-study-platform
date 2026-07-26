import { readFormData } from 'h3'
import { adminUploadSchema, validateSuccess, validateError } from '#server/utils/validate'
import { enqueueAdminMaterial, processAdminBatch } from '#server/utils/adminUpload'
import { ADMIN_MAX_SIZE } from '#server/utils/materialJob'
import { useRuntimeConfig } from '#imports'
import type { AdminUploadResponse, AdminUploadItemResult } from '#shared/types/adminUpload'
import { ensurePermission } from '#server/utils/permission'
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

  const parsed = adminUploadSchema.safeParse({ mode, unitId, voice, isPublic })
  if (!parsed.success) {
    return validateError(parsed.error?.issues?.[0]?.message ?? '参数校验失败', 400)
  }

  const {
    mode: validMode,
    unitId: validUnitId,
    voice: validVoice,
    isPublic: validIsPublic,
  } = parsed.data
  const { oss } = useRuntimeConfig()
  const bucket = oss.bucket as string
  const userId = user.id

  let results: AdminUploadItemResult[]

  if (validMode === 'single') {
    const textContent = formData.get('textContent') as string | null
    const title = formData.get('title') as string | null
    const audio = formData.get('audio') as File | null

    const trimmedText = textContent?.trim() ?? ''
    if (trimmedText.length < 10) {
      return validateError('材料文本不能少于10个字符', 400)
    }
    if (trimmedText.length > 5000) {
      return validateError('材料文本不能超过5000个字符', 400)
    }

    let audioBuffer: Buffer | undefined
    let audioFileName: string | undefined
    if (audio && audio.size > 0) {
      // 大小前置校验：避免超大文件先烧 TTS/OSS 云费、大 Buffer 驻留队列
      if (audio.size > ADMIN_MAX_SIZE) {
        return validateError(`音频大小超过限制（${ADMIN_MAX_SIZE / 1024 / 1024}MB）`, 400)
      }
      audioBuffer = Buffer.from(await audio.arrayBuffer())
      audioFileName = audio.name
    }

    const result = await enqueueAdminMaterial({
      userId,
      unitId: validUnitId,
      textContent: trimmedText,
      title,
      voice: validVoice,
      isPublic: validIsPublic,
      bucket,
      audioBuffer,
      audioFileName,
    })
    results = [{ ...result, index: 0 }]
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
      bucket,
      files: txtFiles,
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
