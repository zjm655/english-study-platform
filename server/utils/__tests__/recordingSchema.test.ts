import { describe, it, expect } from 'vitest'
import { uploadRecordingSchema, progressSchema } from '../validate'

// 回归测试：录音上传和进度更新 schema 校验
// 这些 schema 是 recording 和 user/progress 端点的入参防线，
// 测试 handler 真实会传入的入参类型（multipart 中 duration 为字符串 Number 转化后的 number）

describe('uploadRecordingSchema（录音上传参数校验）', () => {
  it('正常参数：phase=3, duration=10', () => {
    const parsed = uploadRecordingSchema.safeParse({
      segmentId: 1,
      phase: 3,
      duration: 10,
    })
    expect(parsed.success).toBe(true)
  })

  it('正常参数：phase=4, duration=0.1', () => {
    const parsed = uploadRecordingSchema.safeParse({
      segmentId: 1,
      phase: 4,
      duration: 0.1,
    })
    expect(parsed.success).toBe(true)
  })

  it('segmentId 为 0 应被拒绝', () => {
    const parsed = uploadRecordingSchema.safeParse({
      segmentId: 0,
      phase: 3,
      duration: 10,
    })
    expect(parsed.success).toBe(false)
  })

  it('segmentId 为负数应被拒绝', () => {
    const parsed = uploadRecordingSchema.safeParse({
      segmentId: -1,
      phase: 3,
      duration: 10,
    })
    expect(parsed.success).toBe(false)
  })

  it('phase=1 应被拒绝（只允许 3 或 4）', () => {
    const parsed = uploadRecordingSchema.safeParse({
      segmentId: 1,
      phase: 1,
      duration: 10,
    })
    expect(parsed.success).toBe(false)
  })

  it('phase=5 应被拒绝', () => {
    const parsed = uploadRecordingSchema.safeParse({
      segmentId: 1,
      phase: 5,
      duration: 10,
    })
    expect(parsed.success).toBe(false)
  })

  it('duration=0 应被拒绝（时长过短）', () => {
    const parsed = uploadRecordingSchema.safeParse({
      segmentId: 1,
      phase: 3,
      duration: 0,
    })
    expect(parsed.success).toBe(false)
  })

  it('duration=600 应被接受（边界值）', () => {
    const parsed = uploadRecordingSchema.safeParse({
      segmentId: 1,
      phase: 3,
      duration: 600,
    })
    expect(parsed.success).toBe(true)
  })

  it('duration=601 应被拒绝（超过10分钟）', () => {
    const parsed = uploadRecordingSchema.safeParse({
      segmentId: 1,
      phase: 3,
      duration: 601,
    })
    expect(parsed.success).toBe(false)
  })

  it('缺少 segmentId 应被拒绝', () => {
    const parsed = uploadRecordingSchema.safeParse({
      phase: 3,
      duration: 10,
    })
    expect(parsed.success).toBe(false)
  })
})

describe('progressSchema（进度更新参数校验）', () => {
  it('phase1 完成，无需 score', () => {
    const parsed = progressSchema.safeParse({
      segmentId: 1,
      phase: 1,
      done: true,
    })
    expect(parsed.success).toBe(true)
  })

  it('phase2 完成，无需 score', () => {
    const parsed = progressSchema.safeParse({
      segmentId: 1,
      phase: 2,
      done: true,
    })
    expect(parsed.success).toBe(true)
  })

  it('phase3 完成但缺少 score 应被拒绝', () => {
    const parsed = progressSchema.safeParse({
      segmentId: 1,
      phase: 3,
      done: true,
    })
    expect(parsed.success).toBe(false)
  })

  it('phase3 完成且提供 score 应被接受', () => {
    const parsed = progressSchema.safeParse({
      segmentId: 1,
      phase: 3,
      done: true,
      score: 85,
    })
    expect(parsed.success).toBe(true)
  })

  it('phase4 完成但缺少 score 应被拒绝', () => {
    const parsed = progressSchema.safeParse({
      segmentId: 1,
      phase: 4,
      done: true,
    })
    expect(parsed.success).toBe(false)
  })

  it('phase4 完成且提供 score 应被接受', () => {
    const parsed = progressSchema.safeParse({
      segmentId: 1,
      phase: 4,
      done: true,
      score: 90,
    })
    expect(parsed.success).toBe(true)
  })

  it('phase 未完成时不强制要求 score', () => {
    const parsed = progressSchema.safeParse({
      segmentId: 1,
      phase: 3,
      done: false,
    })
    expect(parsed.success).toBe(true)
  })

  it('score 为负数应被拒绝', () => {
    const parsed = progressSchema.safeParse({
      segmentId: 1,
      phase: 3,
      done: true,
      score: -1,
    })
    expect(parsed.success).toBe(false)
  })

  it('score 超过 100 应被拒绝', () => {
    const parsed = progressSchema.safeParse({
      segmentId: 1,
      phase: 3,
      done: true,
      score: 101,
    })
    expect(parsed.success).toBe(false)
  })

  it('phase 为 0 应被拒绝', () => {
    const parsed = progressSchema.safeParse({
      segmentId: 1,
      phase: 0,
      done: true,
    })
    expect(parsed.success).toBe(false)
  })

  it('phase 为 5 应被拒绝', () => {
    const parsed = progressSchema.safeParse({
      segmentId: 1,
      phase: 5,
      done: true,
    })
    expect(parsed.success).toBe(false)
  })
})
