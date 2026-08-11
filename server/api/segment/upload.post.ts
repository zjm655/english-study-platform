import { randomUUID } from 'node:crypto'
import { withQueue } from '#server/services/serviceQueue'
import {
  runMaterialJob,
  createUploadRecord,
  updateRecordFailed,
  isUploadQueueFull,
} from '#server/services/materialJob'
import { getUploadLimits } from '#server/utils/uploadLimitChecker'
import { uploadWithKey, deleteObject } from '#server/utils/oss'
import { extractAudioMeta } from '#server/utils/audioMeta'
import { resolveUploadTitle } from '#server/utils/textParser'
import { query } from '#server/utils/db'
import { validateError, validateSuccess } from '#server/utils/validate'
import type { UploadMaterialResult } from '#shared/types/material'
import { isAdminOrAbove } from '#shared/utils/role'
import { uploadMaterialSchema, uploadMaterialAdminSchema } from '#shared/schemas/material'

/**
 * 上传自定义材料（异步任务模式）
 * 请求：POST /api/segment/upload (multipart/form-data)
 *
 * 同步段只做纯本地操作（解析 + zod 校验 + 建 queued 记录 + 入队），秒级返回 recordId；
 * 完整流水线（审核/STT/TTS/OSS/AI/入库）由 runMaterialJob 在 upload 队列内异步执行，
 * 前端轮询 GET /api/material/records 展示「排队中/处理中/完成/失败」。
 */
export default defineEventHandler(
  async (event): Promise<ResPayload<UploadMaterialResult | null>> => {
    const user = event.context.user
    if (!user) return validateError('未登录', 401)

    // 1. 解析表单
    const formData = await readFormData(event)
    const textContent = formData.get('textContent') as string | null
    const voice = (formData.get('voice') as string | null) || 'en-US-AriaNeural'
    const isPublic = Number(formData.get('isPublic'))
    const unitIdRaw = formData.get('unitId') as string | null
    const audioFile = formData.get('audio') as File | null
    const title = formData.get('title') as string | null
    const titleMode = (formData.get('titleMode') as string | null) ?? undefined
    const fileName = formData.get('fileName') as string | null

    // 2. 角色判断（管理员 / 超管享受管理员上传档：更长时长、可指定单元）
    const isAdmin = isAdminOrAbove(user.role)
    const finalUnitId = isAdmin && unitIdRaw ? Number(unitIdRaw) : 0

    // 3. Zod 校验
    const schema = isAdmin ? uploadMaterialAdminSchema : uploadMaterialSchema
    const parseInput: Record<string, unknown> = { textContent, isPublic, voice, titleMode }
    if (isAdmin) parseInput.unitId = finalUnitId

    const parsed = schema.safeParse(parseInput)
    if (!parsed.success) {
      return validateError(parsed.error.issues[0]?.message || '参数校验失败')
    }

    if (!textContent) return validateError('材料文本不能为空')

    // 3.5 标题模式解析（同步段）：manual 必须填写标题；inline 提取 # 首行并清理正文；filename 用文件名；ai 交流水线生成
    if (parsed.data.titleMode === 'manual' && !title?.trim()) {
      return validateError('请填写标题（手动模式）')
    }
    const resolved = resolveUploadTitle({
      titleMode: parsed.data.titleMode,
      title,
      fileName,
      textContent: textContent.trim(),
    })
    const resolvedText = resolved.textContent.trim()
    if (resolvedText.length < 10) {
      return validateError('提取标题后正文不能少于10个字符')
    }

    // 4. 入队深度防御
    if (await isUploadQueueFull()) {
      return validateError('系统繁忙，请稍后再试', 503)
    }

    // 5. 音频大小/时长前置校验 + 持久化到 OSS（任务失败重处理可复用，不再静默退回 TTS 合成）
    let audioBuffer: Buffer | undefined
    let audioFileName: string | undefined
    let audioOssKey: string | undefined
    if (audioFile && audioFile instanceof File && audioFile.size > 0) {
      // 大小限制运营可调（sys_config），管理员/用户分档
      const limits = await getUploadLimits()
      const maxSize = isAdmin ? limits.maxAudioSizeAdmin : limits.maxAudioSizeUser
      if (audioFile.size > maxSize) {
        return validateError(`音频大小超过限制（${maxSize / 1024 / 1024}MB）`)
      }
      audioBuffer = Buffer.from(await audioFile.arrayBuffer())
      audioFileName = audioFile.name
      // 时长前置校验（管理员/用户分档；流水线内仍有后置兼校）
      const maxDuration = isAdmin ? limits.maxAudioDurationAdmin : limits.maxAudioDurationUser
      const meta = await extractAudioMeta(audioBuffer)
      if (!meta) {
        return validateError('无法解析音频信息')
      }
      if (meta.duration > maxDuration) {
        return validateError(`音频时长超过限制（${maxDuration}s）`)
      }
      const ext = audioFile.name.split('.').pop()?.toLowerCase() || 'mp3'
      audioOssKey = `audio/material/${randomUUID()}.${ext}`
      try {
        await uploadWithKey(audioBuffer, audioOssKey)
      } catch (err) {
        logger.error('[material upload] 同步段音频上传失败:', err)
        return validateError('音频上传失败，请重试')
      }
    }

    // 6. 建 queued 记录（record 是任务唯一真相源；建记录失败清理已持久化的音频孤儿）
    const fallbackTitle =
      resolvedText.length > 50 ? resolvedText.slice(0, 50) + '...' : resolvedText
    const recordTitle = resolved.title ?? fallbackTitle
    let recordId: number
    try {
      recordId = await createUploadRecord(
        user.id,
        recordTitle,
        resolvedText,
        voice,
        isPublic,
        'queued',
        audioOssKey,
      )
    } catch (err) {
      if (audioOssKey) void deleteObject(audioOssKey)
      logger.error('[material upload] 创建上传记录失败:', err)
      return validateError('创建上传记录失败，请重试')
    }

    // 7. 排队位置估算（DB COUNT，重启自洽，不依赖内存队列插桩）
    const aheadRows = await query<{ cnt: number | string }>(
      `SELECT COUNT(*) as cnt FROM material_upload_record WHERE status = 'queued' AND id < ?`,
      [recordId],
    )
    const queuePosition = Number(aheadRows[0]?.cnt ?? 0)

    // 8. 入 upload 队列 fire-and-forget（用户交互任务高优先级；runMaterialJob 内部永不抛出）
    withQueue(
      'upload',
      () =>
        runMaterialJob({
          recordId,
          userId: user.id,
          isAdmin,
          textContent: resolvedText,
          title: resolved.title,
          voice,
          isPublic,
          unitId: finalUnitId,
          audioBuffer,
          audioFileName,
          audioOssKey,
        }),
      { priority: 1 },
    ).catch(async (err) => {
      // 兜底：任务在排队阶段被移除（如进程关闭前 abort）等极端情况；自身绝不再抛
      logger.error('[material upload] 任务入队执行异常:', err)
      await updateRecordFailed(recordId, '任务调度异常，请重试').catch(() => {})
    })

    logger.info(
      `[material upload] 已入队 user=${user.id} record=${recordId} 排队位置=${queuePosition}`,
    )
    return validateSuccess<UploadMaterialResult>(
      { recordId, queuePosition, ...(resolved.notice ? { notice: resolved.notice } : {}) },
      '材料已加入处理队列',
    )
  },
)
