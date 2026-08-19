import { describe, it, expect } from 'vitest'
import { derivePipelineFlow } from '../pipelineFlow'
import { layoutFlow } from '../flowLayout'
import type { PipelineSnapshotLike } from '../pipelineFlow'

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

function diagram(
  stages: Array<{ name: string; ok?: boolean }>,
  status: string,
  failedAt?: string | null,
) {
  return layoutFlow(derivePipelineFlow(snap(stages, failedAt), status), status)
}

describe('layoutFlow', () => {
  it('成功（TTS 路径）：endReached=true、end=完成、主链各边连通', () => {
    const d = diagram(
      [
        { name: 'moderation_text' },
        { name: 'tts_main' },
        { name: 'ai_content' },
        { name: 'title' },
        { name: 'vocab_tts' },
        { name: 'persist' },
      ],
      'success',
    )
    expect(d.endReached).toBe(true)
    expect(d.failedNodeId).toBeNull()
    const end = d.nodes.find((n) => n.kind === 'end')!
    expect(end.label).toBe('完成')
    expect(d.edges.find((e) => e.to === 'end')?.reached).toBe(true)
    expect(d.edges.find((e) => e.from === 'persist')?.reached).toBe(true)
    // TTS 分支走通；右分支（相似度等）未执行置灰
    expect(d.nodes.find((n) => n.id === 'tts_main')!.reached).toBe(true)
    expect(d.nodes.find((n) => n.id === 'similarity')!.reached).toBe(false)
  })

  it('失败（相似度）：failedNodeId=similarity、endReached=false、相似度之后断链且置灰', () => {
    const d = diagram(
      [
        { name: 'moderation_text' },
        { name: 'user_audio' },
        { name: 'stt' },
        { name: 'moderation_nls' },
        { name: 'similarity', ok: false },
      ],
      'failed',
      'similarity',
    )
    expect(d.endReached).toBe(false)
    expect(d.failedNodeId).toBe('similarity')
    const end = d.nodes.find((n) => n.kind === 'end')!
    expect(end.label).toBe('未到达')
    expect(end.status).toBe('not_started')
    // 相似度之后不再连通
    expect(d.edges.find((e) => e.from === 'similarity')?.reached).toBe(false)
    expect(d.nodes.find((n) => n.id === 'speaker_annotate')!.reached).toBe(false)
    expect(d.nodes.find((n) => n.id === 'ai_content')!.reached).toBe(false)
    expect(d.edges.find((e) => e.from === 'persist')?.reached).toBe(false)
    // 相似度之前连通
    expect(d.edges.find((e) => e.to === 'similarity')?.reached).toBe(true)
  })

  it('菱形判断节点与分支条件文案', () => {
    const d = diagram(
      [
        { name: 'moderation_text' },
        { name: 'user_audio' },
        { name: 'stt' },
        { name: 'similarity' },
        { name: 'persist' },
      ],
      'success',
    )
    expect(d.nodes.find((n) => n.id === 'audio_source')!.kind).toBe('decision')
    expect(d.nodes.find((n) => n.id === 'nls')!.kind).toBe('decision')
    const labelOf = (from: string, to: string) =>
      d.edges.find((e) => e.from === from && e.to === to)?.label
    expect(labelOf('audio_source', 'tts_main')).toBe('TTS←无用户音频')
    expect(labelOf('audio_source', 'nls')).toBe('有用户音频')
    expect(labelOf('nls', 'stt')).toBe('是')
    expect(labelOf('nls', 'ai_content')).toBe('否')
  })

  it('NLS 分支文案锚点在空白区，避开菱形/节点遮挡', () => {
    const d = diagram(
      [
        { name: 'moderation_text' },
        { name: 'tts_main' },
        { name: 'ai_content' },
        { name: 'title' },
        { name: 'vocab_tts' },
        { name: 'persist' },
      ],
      'success',
    )
    const nls = d.nodes.find((n) => n.id === 'nls')!
    const stt = d.nodes.find((n) => n.id === 'stt')!
    const speaker = d.nodes.find((n) => n.id === 'speaker_annotate')!
    // 是（nls→stt）：锚点不在菱形内部矩形（向内缩 10px 的近似矩形）
    const yes = d.edges.find((e) => e.from === 'nls' && e.to === 'stt')!.labelAnchor!
    const inDiamondInterior =
      yes.x >= nls.x + 10 &&
      yes.x <= nls.x + nls.w - 10 &&
      yes.y >= nls.y + 10 &&
      yes.y <= nls.y + nls.h - 10
    expect(inDiamondInterior).toBe(false)
    // 是：也不落在 stt 节点矩形上
    const inStt =
      yes.x >= stt.x && yes.x <= stt.x + stt.w && yes.y >= stt.y && yes.y <= stt.y + stt.h
    expect(inStt).toBe(false)
    // 否（nls→ai_content）：锚点不在 speaker_annotate 节点矩形上
    const no = d.edges.find((e) => e.from === 'nls' && e.to === 'ai_content')!.labelAnchor!
    const inSpeaker =
      no.x >= speaker.x &&
      no.x <= speaker.x + speaker.w &&
      no.y >= speaker.y &&
      no.y <= speaker.y + speaker.h
    expect(inSpeaker).toBe(false)
    // 否：落在右侧垂直连接器附近（x≈720）
    expect(no.x).toBe(720)
  })

  it('泳道分组：4 泳道、各阶段归属正确', () => {
    const d = diagram(
      [
        { name: 'moderation_text' },
        { name: 'user_audio' },
        { name: 'stt' },
        { name: 'similarity' },
        { name: 'ai_content' },
        { name: 'persist' },
      ],
      'success',
    )
    expect(d.lanes.map((l) => l.label)).toEqual([
      '输入与审核',
      '音频与 NLS 校对',
      'AI 内容生成',
      '持久化',
    ])
    expect(d.nodes.find((n) => n.id === 'moderation_text')!.lane).toBe(0)
    expect(d.nodes.find((n) => n.id === 'stt')!.lane).toBe(1)
    expect(d.nodes.find((n) => n.id === 'ai_content')!.lane).toBe(2)
    expect(d.nodes.find((n) => n.id === 'persist')!.lane).toBe(3)
    // 起终点在对应泳道
    expect(d.nodes.find((n) => n.kind === 'start')!.lane).toBe(0)
    expect(d.nodes.find((n) => n.kind === 'end')!.lane).toBe(3)
  })

  it('未开启边（nls→ai_content）从 NLS 列右侧绕行，绕过整列', () => {
    const d = diagram(
      [
        { name: 'moderation_text' },
        { name: 'tts_main' },
        { name: 'ai_content' },
        { name: 'title' },
        { name: 'vocab_tts' },
        { name: 'persist' },
      ],
      'success',
    )
    const e = d.edges.find((e) => e.from === 'nls' && e.to === 'ai_content')!
    const ai = d.nodes.find((n) => n.id === 'ai_content')!
    const nls = d.nodes.find((n) => n.id === 'nls')!
    const speaker = d.nodes.find((n) => n.id === 'speaker_annotate')!
    const xs = e.points.map((p) => p.x)
    // 存在明显大于 NLS 列右缘（nls.x+nls.w=690）的绕行 x
    expect(Math.max(...xs)).toBeGreaterThan(nls.x + nls.w)
    // 从 nls 右缘中点出发
    expect(e.points[0]!.x).toBe(nls.x + nls.w)
    expect(e.points[0]!.y).toBe(nls.y + nls.h / 2)
    // 绕行下到 NLS 模块最下节点之下
    expect(e.points.some((p) => p.y > speaker.y + speaker.h)).toBe(true)
    // 入口在 ai_content 右缘顶边
    const last = e.points[e.points.length - 1]!
    expect(last.x).toBe(ai.x + ai.w)
    expect(last.y).toBe(ai.y)
  })

  it('未开启 与 tts_main 汇入 ai_content 的入口 x 不同', () => {
    const d = diagram(
      [
        { name: 'moderation_text' },
        { name: 'tts_main' },
        { name: 'ai_content' },
        { name: 'title' },
        { name: 'vocab_tts' },
        { name: 'persist' },
      ],
      'success',
    )
    const ai = d.nodes.find((n) => n.id === 'ai_content')!
    const off = d.edges.find((e) => e.from === 'nls' && e.to === 'ai_content')!
    const ttsIn = d.edges.find((e) => e.from === 'tts_main' && e.to === 'ai_content')!
    const offEntry = off.points[off.points.length - 1]!.x
    const ttsEntry = ttsIn.points[ttsIn.points.length - 1]!.x
    expect(offEntry).toBe(ai.x + ai.w) // 右缘 480
    expect(ttsEntry).toBe(ai.x) // 左缘 300
    expect(offEntry).not.toBe(ttsEntry)
  })

  it('开启 NLS（nls→stt）为唯一直垂段（各点同 x）', () => {
    const d = diagram(
      [
        { name: 'moderation_text' },
        { name: 'user_audio' },
        { name: 'stt' },
        { name: 'moderation_nls' },
        { name: 'similarity' },
        { name: 'speaker_annotate' },
        { name: 'ai_content' },
        { name: 'persist' },
      ],
      'success',
    )
    const e = d.edges.find((e) => e.from === 'nls' && e.to === 'stt')!
    const xs = e.points.map((p) => p.x)
    expect(new Set(xs).size).toBe(1)
  })
})
