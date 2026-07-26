import { withQueue } from '#server/utils/serviceQueue'
import {
  runMaterialJob,
  createUploadRecord,
  updateRecordFailed,
  isUploadQueueFull,
  USER_MAX_SIZE,
  ADMIN_MAX_SIZE,
} from '#server/utils/materialJob'
import { query } from '#server/utils/db'
import {
  validateError,
  validateSuccess,
  uploadMaterialSchema,
  uploadMaterialAdminSchema,
} from '#server/utils/validate'
import type { UploadMaterialResult } from '#shared/types/material'
import { isAdminOrAbove } from '#shared/utils/role'

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

    // 2. 角色判断（管理员 / 超管享受管理员上传档：更长时长、可指定单元）
    const isAdmin = isAdminOrAbove(user.role)
    const finalUnitId = isAdmin && unitIdRaw ? Number(unitIdRaw) : 0

    // 3. Zod 校验
    const schema = isAdmin ? uploadMaterialAdminSchema : uploadMaterialSchema
    const parseInput: Record<string, unknown> = { textContent, isPublic, voice }
    if (isAdmin) parseInput.unitId = finalUnitId

    const parsed = schema.safeParse(parseInput)
    if (!parsed.success) {
      return validateError(parsed.error.issues[0]?.message || '参数校验失败')
    }

    if (!textContent) return validateError('材料文本不能为空')

    // 4. 入队深度防御
    if (await isUploadQueueFull()) {
      return validateError('系统繁忙，请稍后再试', 503)
    }

    // 5. 音频大小前置校验 + Buffer 拷贝进任务闭包（任务与 event 生命周期解耦）
    // 提前拦截超大文件：避免先烧 STT/OSS 云费、大 Buffer 驻留队列（流水线内 Step 3 仍有后置兼校）
    let audioBuffer: Buffer | undefined
    let audioFileName: string | undefined
    if (audioFile && audioFile instanceof File && audioFile.size > 0) {
      const maxSize = isAdmin ? ADMIN_MAX_SIZE : USER_MAX_SIZE
      if (audioFile.size > maxSize) {
        return validateError(`音频大小超过限制（${maxSize / 1024 / 1024}MB）`)
      }
      audioBuffer = Buffer.from(await audioFile.arrayBuffer())
      audioFileName = audioFile.name
    }

    // 6. 建 queued 记录（record 是任务唯一真相源）
    const fallbackTitle = textContent.length > 50 ? textContent.slice(0, 50) + '...' : textContent
    const recordId = await createUploadRecord(user.id, fallbackTitle, textContent, voice, isPublic)

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
          textContent,
          voice,
          isPublic,
          unitId: finalUnitId,
          audioBuffer,
          audioFileName,
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
    return validateSuccess<UploadMaterialResult>({ recordId, queuePosition }, '材料已加入处理队列')
  },
)
