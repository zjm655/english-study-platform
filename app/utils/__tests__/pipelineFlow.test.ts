import { describe, it, expect } from 'vitest'
import { deriveStageStatuses, derivePipelineFlow } from '../pipelineFlow'
import type { PipelineSnapshotLike, FlowNode, FlowDecision, FlowStage } from '../pipelineFlow'

/** 便捷构造快照 */
function snap(
  stages: Array<{ name: string; ok?: boolean }>,
  failedAt?: string | null,
): PipelineSnapshotLike {
  return {
    stages: stages.map((s) => ({ name: s.name, ok: s.ok ?? true })),
    failedAt: failedAt ?? null,
    finalError: null,
  }
}

function statusByName(nodes: ReturnType<typeof deriveStageStatuses>, key: string) {
  return nodes.find((n) => n.key === key)?.status
}

// 决策树辅助：取某 key 的 decision
function findDecision(chain: FlowNode[], key: string): FlowDecision {
  const d = chain.find((n) => n.kind === 'decision' && n.key === key) as FlowDecision
  if (!d) throw new Error(`no decision ${key}`)
  return d
}

describe('deriveStageStatuses（线性四态）', () => {
  it('成功记录全绿，未执行阶段灰', () => {
    const nodes = deriveStageStatuses(
      snap([
        { name: 'moderation_text' },
        { name: 'stt' },
        { name: 'similarity' },
        { name: 'persist' },
      ]),
      'success',
    )
    expect(statusByName(nodes, 'stt')).toBe('success')
    expect(statusByName(nodes, 'tts_main')).toBe('not_started')
  })

  it('相似度失败：相似度红、后置灰、前置绿', () => {
    const nodes = deriveStageStatuses(
      snap(
        [
          { name: 'moderation_text' },
          { name: 'stt' },
          { name: 'moderation_nls' },
          { name: 'similarity', ok: false },
        ],
        'similarity',
      ),
      'failed',
    )
    expect(statusByName(nodes, 'similarity')).toBe('failed')
    expect(statusByName(nodes, 'stt')).toBe('success')
    expect(statusByName(nodes, 'persist')).toBe('not_started')
  })

  it('非阻塞异常（说话人标注 ok=false）→ exception，后续正常', () => {
    const nodes = deriveStageStatuses(
      snap([
        { name: 'moderation_text' },
        { name: 'stt' },
        { name: 'similarity' },
        { name: 'speaker_annotate', ok: false },
        { name: 'ai_content' },
        { name: 'persist' },
      ]),
      'success',
    )
    expect(statusByName(nodes, 'speaker_annotate')).toBe('exception')
    expect(statusByName(nodes, 'persist')).toBe('success')
  })
})

describe('derivePipelineFlow（决策树分叉）', () => {
  it('无用户音频（tts_main）：走 TTS 分支，用户音频分支整支未走(灰)，NLS 不入链', () => {
    const chain = derivePipelineFlow(
      snap([
        { name: 'moderation_text' },
        { name: 'tts_main' },
        { name: 'ai_content' },
        { name: 'vocab_tts' },
        { name: 'persist' },
      ]),
      'success',
    )
    expect(chain[0]!.kind).toBe('stage')
    expect((chain[0]! as FlowStage).key).toBe('moderation_text')
    expect((chain[0]! as FlowStage).status).toBe('success')

    const audio = findDecision(chain, 'audio_source')
    const tts = audio.branches.find((b) => b.key === 'tts')!
    const user = audio.branches.find((b) => b.key === 'user')!
    expect(tts.taken).toBe(true)
    expect(tts.status).toBe('success')
    expect(tts.nodes[0]!.kind).toBe('stage')
    expect(user.taken).toBe(false)
    expect(user.status).toBe('not_started')
  })

  it('有用户音频 + 开启 NLS：走用户音频分支，NLS=on，STT 链各阶段按快照着色，TTS 分支灰', () => {
    const chain = derivePipelineFlow(
      snap(
        [
          { name: 'moderation_text' },
          { name: 'user_audio' },
          { name: 'stt' },
          { name: 'moderation_nls' },
          { name: 'similarity', ok: false }, // 相似度失败
        ],
        'similarity',
      ),
      'failed',
    )
    const audio = findDecision(chain, 'audio_source')
    const user = audio.branches.find((b) => b.key === 'user')!
    const tts = audio.branches.find((b) => b.key === 'tts')!
    expect(user.taken).toBe(true)
    expect(user.status).toBe('failed')
    expect(tts.taken).toBe(false)

    const nls = findDecision(user.nodes as FlowNode[], 'nls')
    const on = nls.branches.find((b) => b.key === 'on')!
    const off = nls.branches.find((b) => b.key === 'off')!
    expect(on.taken).toBe(true)
    expect(on.status).toBe('failed')
    const simStage = on.nodes.find(
      (n) => n.kind === 'stage' && (n as FlowStage).key === 'similarity',
    )
    expect((simStage as FlowStage).status).toBe('failed')
    expect(off.taken).toBe(false)
  })

  it('有用户音频 + 未开启 NLS：NLS=off（直接用音频），无 STT 阶段', () => {
    const chain = derivePipelineFlow(
      snap([
        { name: 'moderation_text' },
        { name: 'user_audio' },
        { name: 'ai_content' },
        { name: 'persist' },
      ]),
      'success',
    )
    const audio = findDecision(chain, 'audio_source')
    const user = audio.branches.find((b) => b.key === 'user')!
    const nls = findDecision(user.nodes as FlowNode[], 'nls')
    const off = nls.branches.find((b) => b.key === 'off')!
    const on = nls.branches.find((b) => b.key === 'on')!
    expect(off.taken).toBe(true)
    expect(on.taken).toBe(false)
  })

  it('空快照：主链各阶段灰、两分支均未走', () => {
    const chain = derivePipelineFlow(null, 'failed')
    const stageKeys = chain.filter((n) => n.kind === 'stage').map((n) => (n as FlowStage).status)
    expect(stageKeys.every((s) => s === 'not_started')).toBe(true)
    const audio = findDecision(chain, 'audio_source')
    expect(audio.branches.every((b) => b.taken === false && b.status === 'not_started')).toBe(true)
  })
})
