import { describe, it, expect } from 'vitest'
import { adminUploadSchema } from '#shared/schemas/material'

// 回归测试：堵住 C1/C3 测试盲区。
// handler 从 multipart formData 拿到的 unitId/isPublic 是字符串或缺失(null)，
// 旧 schema 的 unitId 缺 z.coerce → z.number() 拒字符串 → 接口对所有真实请求恒 400；
// isPublic 的 .default(1) 因 null 被 coerce 成 0 而失效。旧测试直调 processAdminMaterial
// （传数字 unitId）绕过了 handler，故未暴露。此处用 handler 真实会传入的入参类型校验 schema。
describe('adminUploadSchema（multipart 字符串入参回归）', () => {
  it('C1: unitId 字符串 "0" 应被 coerce 为数字 0（而非拒绝）', () => {
    const parsed = adminUploadSchema.safeParse({
      mode: 'single',
      unitId: '0',
      voice: 'en-US-AriaNeural',
      isPublic: '1',
    })
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data.unitId).toBe(0)
  })

  it('C1: unitId 字符串 "5" 应被 coerce 为 5', () => {
    const parsed = adminUploadSchema.safeParse({
      mode: 'batch',
      unitId: '5',
      voice: 'en-US-AriaNeural',
      isPublic: '0',
    })
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data.unitId).toBe(5)
  })

  it('C1: unitId 负数应被拒绝', () => {
    const parsed = adminUploadSchema.safeParse({
      mode: 'single',
      unitId: '-1',
      voice: 'en-US-AriaNeural',
      isPublic: '1',
    })
    expect(parsed.success).toBe(false)
  })

  it('C3: isPublic 缺失（null）应默认公开 1', () => {
    const parsed = adminUploadSchema.safeParse({
      mode: 'single',
      unitId: '0',
      voice: 'en-US-AriaNeural',
      isPublic: null,
    })
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data.isPublic).toBe(1)
  })

  it('C3: isPublic 缺失（undefined）应默认公开 1', () => {
    const parsed = adminUploadSchema.safeParse({
      mode: 'single',
      unitId: '0',
      voice: 'en-US-AriaNeural',
    })
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data.isPublic).toBe(1)
  })

  it('C3: isPublic "0" 应为私有 0', () => {
    const parsed = adminUploadSchema.safeParse({
      mode: 'single',
      unitId: '0',
      voice: 'en-US-AriaNeural',
      isPublic: '0',
    })
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data.isPublic).toBe(0)
  })

  it('voice 缺省应使用默认音色', () => {
    const parsed = adminUploadSchema.safeParse({ mode: 'single', unitId: '0', isPublic: '1' })
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data.voice).toBe('en-US-AriaNeural')
  })

  it('mode 非法应被拒绝', () => {
    const parsed = adminUploadSchema.safeParse({ mode: 'invalid', unitId: '0', isPublic: '1' })
    expect(parsed.success).toBe(false)
  })

  it('C-titleMode: 缺失（null）应默认 AI 生成 ai', () => {
    const parsed = adminUploadSchema.safeParse({
      mode: 'single',
      unitId: '0',
      isPublic: '1',
      titleMode: null,
    })
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data.titleMode).toBe('ai')
  })

  it('C-titleMode: 缺失（undefined）应默认 AI 生成 ai', () => {
    const parsed = adminUploadSchema.safeParse({
      mode: 'single',
      unitId: '0',
      isPublic: '1',
    })
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data.titleMode).toBe('ai')
  })

  it('C-titleMode: 合法值 inline/text_filename/audio_filename/manual/ai 均应通过', () => {
    for (const v of ['inline', 'text_filename', 'audio_filename', 'manual', 'ai']) {
      const parsed = adminUploadSchema.safeParse({
        mode: 'single',
        unitId: '0',
        isPublic: '1',
        titleMode: v,
      })
      expect(parsed.success).toBe(true)
      if (parsed.success) expect(parsed.data.titleMode).toBe(v)
    }
  })

  it('C-titleMode: 非法值（auto）应被拒绝', () => {
    const parsed = adminUploadSchema.safeParse({
      mode: 'single',
      unitId: '0',
      isPublic: '1',
      titleMode: 'auto',
    })
    expect(parsed.success).toBe(false)
  })
})
