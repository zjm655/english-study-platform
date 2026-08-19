import { describe, it, expect } from 'vitest'
import { PipelineSnapshotBuilder } from '../pipelineSnapshot'

describe('PipelineSnapshotBuilder', () => {
  it('累计阶段并在失败时含 failedAt/finalError', () => {
    const b = new PipelineSnapshotBuilder()
    b.add('moderation_text', false, { safe: false, reason: '非英文' })
    b.setFailed('moderation_text', '材料内容不合规: 非英文')

    const parsed = JSON.parse(b.toJSON())
    expect(parsed.stages).toHaveLength(1)
    expect(parsed.stages[0]).toMatchObject({ name: 'moderation_text', ok: false })
    expect(parsed.failedAt).toBe('moderation_text')
    expect(parsed.finalError).toContain('材料内容不合规')
  })

  it('成功路径：多阶段全 ok，failedAt 为 null', () => {
    const b = new PipelineSnapshotBuilder()
    b.add('moderation_text', true)
    b.add('stt', true, { text: 'transcript' })
    b.add('ai_content', true, { vocabCount: 3, questionCount: 2 })

    const parsed = JSON.parse(b.toJSON())
    expect(parsed.stages).toHaveLength(3)
    expect(parsed.stages[2].detail).toEqual({ vocabCount: 3, questionCount: 2 })
    expect(parsed.failedAt ?? null).toBeNull()
    expect(parsed.finalError ?? null).toBeNull()
  })
})
