/**
 * 诊断流程图布局（前端纯函数，可单测）
 *
 * 把 derivePipelineFlow 的决策树布局为 SVG 可渲染的「流程图表」：
 * - 垂直主动线（顶部→底部）+ 起终点。
 * - 菱形判断节点（主音频来源? / 是否NLS）引出分支，分支边带条件文案。
 * - 按职责分泳道（输入与审核 / 音频与NLS / AI内容 / 持久化）。
 * - 贯通性：成功 endReached=true 一路连到「完成」；失败在失败节点断链，
 *   其后未执行节点置灰、进入它们的边为灰色虚线（无箭头），end 未到达。
 */
import type { FlowNode, FlowDecision, StageStatus } from './pipelineFlow'

export type FlowNodeKind = 'start' | 'end' | 'stage' | 'decision'

export interface FlowDiagramNode {
  id: string
  kind: FlowNodeKind
  label: string
  status: StageStatus
  reached: boolean
  x: number
  y: number
  w: number
  h: number
  lane: number
}

export interface FlowPoint {
  x: number
  y: number
}

/** type: branch=菱形引出分支（带条件文案）；join=分支汇入主链；spine=主链直连 */
export type FlowEdgeKind = 'spine' | 'branch' | 'join'

export interface FlowDiagramEdge {
  id: string
  from: string
  to: string
  label: string
  /** 可选显式文案锚点；缺省时由渲染器基于 points 自动推算 */
  labelAnchor?: FlowPoint
  kind: FlowEdgeKind
  reached: boolean
  points: FlowPoint[]
}

export interface FlowLane {
  index: number
  label: string
  y: number
  h: number
}

export interface FlowDiagram {
  lanes: FlowLane[]
  nodes: FlowDiagramNode[]
  edges: FlowDiagramEdge[]
  width: number
  height: number
  endReached: boolean
  failedNodeId: string | null
}

const NODE_W = 180
const NODE_H = 46
const DIAMOND_W = 180
const DIAMOND_H = 64
const START_H = 40
const END_H = 40
const VGAP = 30
const PAD = 48
const COL_C = 300 // 主链列左缘
const COL_L = 90 // 左分支（TTS）
const COL_R = 510 // 右分支（用户音频/NLS）

const cx = (n: { x: number; w: number }) => n.x + n.w / 2

/** 垂直主链直连 */
function vLine(a: FlowDiagramNode, b: FlowDiagramNode): FlowPoint[] {
  const x = cx(a)
  return [
    { x, y: a.y + a.h },
    { x, y: b.y },
  ]
}

/** 菱形底部 → 分支节点顶部 正交肘（先垂直后水平再垂直） */
function ortho(from: FlowDiagramNode, to: FlowDiagramNode): FlowPoint[] {
  const fromP: FlowPoint = { x: cx(from), y: from.y + from.h }
  const toP: FlowPoint = { x: cx(to), y: to.y }
  if (fromP.x === toP.x) return [fromP, toP]
  const midY = Math.round((fromP.y + toP.y) / 2)
  return [fromP, { x: fromP.x, y: midY }, { x: toP.x, y: midY }, toP]
}

/** 分支汇入主链（水平再垂直） */
function elbowTo(from: FlowDiagramNode, to: FlowDiagramNode): FlowPoint[] {
  const fromP: FlowPoint = { x: cx(from), y: from.y + from.h }
  const toP: FlowPoint = { x: cx(to), y: to.y }
  if (fromP.x === toP.x) return [fromP, toP]
  return [fromP, { x: toP.x, y: fromP.y }, toP]
}

/**
 * 布局主流程（derivePipelineFlow 输出形状固定）。
 */
export function layoutFlow(
  tree: FlowNode[],
  recordStatus: string | null | undefined,
): FlowDiagram {
  const stageStatus = new Map<string, StageStatus>()
  const walk = (nodes: FlowNode[]) => {
    for (const n of nodes) {
      if (n.kind === 'stage') stageStatus.set(n.key, n.status)
      else if (n.kind === 'decision') for (const b of n.branches) walk(b.nodes)
    }
  }
  walk(tree)
  const st = (id: string) => stageStatus.get(id) ?? 'not_started'

  const recordFailed = recordStatus === 'failed'
  const endReached = !recordFailed

  // 分支走向（供泳道/占位判断，布局始终展示两分支结构）
  const audio = tree.find((n) => n.kind === 'decision' && n.key === 'audio_source') as
    | FlowDecision
    | undefined
  const userBranch = audio?.branches.find((b) => b.key === 'user')
  const userTaken = userBranch?.taken ?? false
  const nlsD = userBranch?.nodes.find((n) => n.kind === 'decision' && n.key === 'nls') as
    | FlowDecision
    | undefined
  const nlsOn = nlsD?.branches.find((b) => b.key === 'on')?.taken ?? false

  // ---------- 泳道 ----------
  const lanes: FlowLane[] = [
    { index: 0, label: '输入与审核', y: 40, h: 260 },
    { index: 1, label: '音频与 NLS 校对', y: 320, h: 400 },
    { index: 2, label: 'AI 内容生成', y: 740, h: 220 },
    { index: 3, label: '持久化', y: 980, h: 180 },
  ]
  const rowY = (lane: number, row: number, h = NODE_H) =>
    lanes[lane]!.y + PAD + row * (h + VGAP)

  // 主链列 / 分支列 阶段盒子
  const stageNode = (
    id: string,
    label: string,
    lane: number,
    row: number,
    col: 'center' | 'left' | 'right',
  ): FlowDiagramNode => {
    const status = st(id)
    return {
      id,
      kind: 'stage',
      label,
      status,
      reached: status !== 'not_started',
      x: col === 'center' ? COL_C : col === 'left' ? COL_L : COL_R,
      y: rowY(lane, row),
      w: NODE_W,
      h: NODE_H,
      lane,
    }
  }
  const diamond = (
    id: string,
    label: string,
    lane: number,
    row: number,
    col: 'center' | 'right',
  ): FlowDiagramNode => ({
    id,
    kind: 'decision',
    label,
    status: 'not_started',
    reached: true,
    x: col === 'center' ? COL_C : COL_R,
    y: rowY(lane, row, DIAMOND_H),
    w: DIAMOND_W,
    h: DIAMOND_H,
    lane,
  })

  const nodes: FlowDiagramNode[] = [
    { id: 'start', kind: 'start', label: '开始', status: 'not_started', reached: true, x: COL_C, y: rowY(0, 0, START_H), w: NODE_W, h: START_H, lane: 0 },
    stageNode('moderation_text', '文本内容审核', 0, 1, 'center'),
    diamond('audio_source', '主音频来源', 0, 2, 'center'),
    stageNode('tts_main', '主音频 TTS', 1, 0, 'left'),
    diamond('nls', '是否开启 NLS', 1, 0, 'right'),
    stageNode('stt', 'NLS 识别', 1, 1, 'right'),
    stageNode('moderation_nls', '音频文本审核', 1, 2, 'right'),
    stageNode('similarity', '音文相似度', 1, 3, 'right'),
    stageNode('speaker_annotate', '说话人标注', 1, 4, 'right'),
    stageNode('ai_content', 'AI 内容生成', 2, 0, 'center'),
    stageNode('title', '标题生成', 2, 1, 'center'),
    stageNode('vocab_tts', '词汇音频生成', 2, 2, 'center'),
    stageNode('persist', '入库', 3, 0, 'center'),
    { id: 'end', kind: 'end', label: endReached ? '完成' : '未到达', status: endReached ? 'success' : 'not_started', reached: endReached, x: COL_C, y: rowY(3, 1, END_H), w: NODE_W, h: END_H, lane: 3 },
  ]
  const byId = (id: string) => nodes.find((n) => n.id === id)!

  // 失败终端节点
  let failedNodeId: string | null = null
  if (recordFailed) {
    const f = nodes.find((n) => n.kind === 'stage' && n.status === 'failed')
    failedNodeId = f?.id ?? null
  }

  // ---------- 边 ----------
  const edges: FlowDiagramEdge[] = []
  const edge = (
    from: string,
    to: string,
    kind: FlowEdgeKind,
    label: string,
    points: FlowPoint[],
    labelAnchor?: FlowPoint,
  ) => {
    const a = byId(from)
    const b = byId(to)
    const reached = a.reached && b.reached && !(a.kind === 'stage' && a.status === 'failed')
    const e: FlowDiagramEdge = { id: `${from}:${to}`, from, to, label, kind, reached, points, ...(labelAnchor ? { labelAnchor } : {}) }
    edges.push(e)
    return e
  }
  const V = (from: string, to: string) => vLine(byId(from), byId(to))
  const O = (from: string, to: string) => ortho(byId(from), byId(to))
  const E = (from: string, to: string) => elbowTo(byId(from), byId(to))

  edge('start', 'moderation_text', 'spine', '', V('start', 'moderation_text'))
  edge('moderation_text', 'audio_source', 'spine', '', V('moderation_text', 'audio_source'))
  edge('audio_source', 'tts_main', 'branch', 'TTS←无用户音频', O('audio_source', 'tts_main'))
  edge('audio_source', 'nls', 'branch', '有用户音频', O('audio_source', 'nls'))

  // tts_main → ai_content：主链并入，从 ai_content 左缘（x=COL_C）垂直进入，独立于未开启右缘 x=480
  const tts = byId('tts_main')
  const ai = byId('ai_content')
  const ttsToAi: FlowPoint[] = [
    { x: cx(tts), y: tts.y + tts.h },
    { x: ai.x, y: tts.y + tts.h },
    { x: ai.x, y: ai.y },
  ]
  edge('tts_main', 'ai_content', 'join', '', ttsToAi)

  // nls → stt：开启 NLS，直下（stt 与 nls 同列居中，ortho 退化为单垂段）
  const nls = byId('nls')
  const nlsToStt = edge('nls', 'stt', 'branch', '是', O('nls', 'stt'), { x: 648, y: 426 })
  nlsToStt.reached = nlsOn

  // nls → ai_content：未开启，自 nls 右侧绕行 NLS 列下方，再从 ai_content 右缘进入
  const speaker = byId('speaker_annotate')
  const bypassX = 720 // 需 > nls 列右缘(x+w=690) 且 < width(760)
  const bypassY = speaker.y + speaker.h + 6 // NLS 模块最下节点之下
  const nlsToAiPoints: FlowPoint[] = [
    { x: nls.x + nls.w, y: nls.y + nls.h / 2 },
    { x: bypassX, y: nls.y + nls.h / 2 },
    { x: bypassX, y: bypassY },
    { x: ai.x + ai.w, y: bypassY },
    { x: ai.x + ai.w, y: ai.y },
  ]
  const nlsToAi = edge('nls', 'ai_content', 'join', '否', nlsToAiPoints, { x: 720, y: 560 })
  nlsToAi.reached = userTaken && !nlsOn
  edge('stt', 'moderation_nls', 'spine', '', V('stt', 'moderation_nls'))
  edge('moderation_nls', 'similarity', 'spine', '', V('moderation_nls', 'similarity'))
  edge('similarity', 'speaker_annotate', 'spine', '', V('similarity', 'speaker_annotate'))
  edge('speaker_annotate', 'ai_content', 'join', '', E('speaker_annotate', 'ai_content'))
  edge('ai_content', 'title', 'spine', '', V('ai_content', 'title'))
  edge('title', 'vocab_tts', 'spine', '', V('title', 'vocab_tts'))
  edge('vocab_tts', 'persist', 'spine', '', V('vocab_tts', 'persist'))
  edge('persist', 'end', 'spine', '', V('persist', 'end'))

  const width = 760
  const height = lanes[3]!.y + lanes[3]!.h + 20

  return { lanes, nodes, edges, width, height, endReached, failedNodeId }
}