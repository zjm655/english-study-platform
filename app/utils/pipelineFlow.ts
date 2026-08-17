/**
 * 材料上传流水线决策树（前端纯函数，可单测）
 *
 * 诊断页据此渲染「分支决策树」流程图：
 * - 主链：文本内容审核(第 1 步) → 主音频来源分叉 → AI 内容 → 标题 → 词汇音频 → 入库。
 * - 分叉：主音频来源（无用户音频→TTS 合成 / 有用户音频）、用户音频内是否开启 NLS（STT 链 / 无）。
 * - 状态四色：绿=成功 / 红=失败终点 / 黄=异常(ok=false 非阻塞) / 灰=未开始或未走分支。
 * 走向依据快照阶段存在性判定（user_audio / tts_main / stt 等）。
 */

export type StageStatus = 'success' | 'failed' | 'exception' | 'not_started'

export interface PipelineStageLike {
  name: string
  ok: boolean
}
export interface PipelineSnapshotLike {
  stages: PipelineStageLike[]
  failedAt?: string | null
  finalError?: string | null
}

/** 线性蓝图（deriveStageStatuses 用；同时是诊断页状态推导基础） */
export interface PipelineNodeDef {
  key: string
  label: string
}
export interface PipelineNodeResult extends PipelineNodeDef {
  status: StageStatus
}

export const PIPELINE_NODES: PipelineNodeDef[] = [
  { key: 'moderation_text', label: '文本审核' },
  { key: 'stt', label: 'NLS 识别' },
  { key: 'moderation_nls', label: '音频文本审核' },
  { key: 'similarity', label: '音文相似度' },
  { key: 'speaker_annotate', label: '说话人标注' },
  { key: 'tts_main', label: '主音频 TTS' },
  { key: 'ai_content', label: 'AI 内容生成' },
  { key: 'title', label: '标题生成' },
  { key: 'vocab_tts', label: '词汇音频生成' },
  { key: 'persist', label: '入库' },
]

const GENERIC_FAILED_AT = 'pipeline'

/**
 * 推导每个蓝图节点的四态（线性；供决策树复用阶段状态与舞台标签）。
 * - failed：记录失败且该节点是失败终点（failedAt 指向它；缺失/通用时取最后已执行阶段）。
 * - not_started：快照无该阶段。
 * - success：快照有且 ok=true。
 * - exception：快照有且 ok=false（非终态）。
 */
export function deriveStageStatuses(
  snapshot: PipelineSnapshotLike | null,
  recordStatus: string | null | undefined,
): PipelineNodeResult[] {
  const recordFailed = recordStatus === 'failed'
  const stages = snapshot?.stages ?? []
  let terminalKey: string | null = null
  if (recordFailed) {
    const failedAt = snapshot?.failedAt
    if (failedAt && failedAt !== GENERIC_FAILED_AT) terminalKey = failedAt
    else terminalKey = stages.length ? stages[stages.length - 1]!.name : null
  }
  return PIPELINE_NODES.map((node) => {
    if (terminalKey === node.key) return { ...node, status: 'failed' as const }
    const stage = stages.find((s) => s.name === node.key)
    if (!stage) return { ...node, status: 'not_started' as const }
    return { ...node, status: stage.ok ? ('success' as const) : ('exception' as const) }
  })
}

// ---------- 决策树 ----------

export interface FlowStage {
  kind: 'stage'
  key: string
  label: string
  status: StageStatus
}
export interface FlowBranch {
  key: string
  label: string
  taken: boolean
  status: StageStatus
  nodes: FlowNode[]
}
export interface FlowDecision {
  kind: 'decision'
  key: string
  question: string
  branches: FlowBranch[]
}
export type FlowNode = FlowStage | FlowDecision

/** 从线性状态表取单阶段状态 */
function statusOf(statuses: Map<string, StageStatus>, key: string): StageStatus {
  return statuses.get(key) ?? 'not_started'
}

/** 递归取子树最坏状态：failed > exception > success > not_started */
function subtreeWorst(nodes: FlowNode[]): StageStatus {
  const rank: Record<StageStatus, number> = { not_started: 0, success: 1, exception: 2, failed: 3 }
  let worst: StageStatus = 'not_started'
  const walk = (list: FlowNode[]) => {
    for (const n of list) {
      if (n.kind === 'stage') {
        if (rank[n.status] > rank[worst]) worst = n.status
      } else if (n.kind === 'decision') {
        for (const b of n.branches) walk(b.nodes)
      }
    }
  }
  walk(nodes)
  return worst
}

/** 分支状态：未走=灰；空（只跳过）=成功；否则取子树最坏 */
function branchTakenStatus(taken: boolean, nodes: FlowNode[]): StageStatus {
  if (!taken) return 'not_started'
  if (nodes.length === 0) return 'success'
  return subtreeWorst(nodes)
}

function stageNode(
  key: string,
  label: string,
  statuses: Map<string, StageStatus>,
): FlowStage {
  return { kind: 'stage', key, label, status: statusOf(statuses, key) }
}

/**
 * 推导完整决策树（按记录实际上报的快照判定走向）。
 * @returns 顶部垂直链：stage / decision（含分支与分支内 stage / 子 decision）
 */
export function derivePipelineFlow(
  snapshot: PipelineSnapshotLike | null,
  recordStatus: string | null | undefined,
): FlowNode[] {
  const statuses = new Map<string, StageStatus>()
  for (const n of deriveStageStatuses(snapshot, recordStatus)) statuses.set(n.key, n.status)

  const has = (k: string) => !!snapshot?.stages?.some((s) => s.name === k)
  const ttsTaken = has('tts_main')
  const userTaken = has('user_audio')
  const nlsOn = ['stt', 'moderation_nls', 'similarity', 'speaker_annotate'].some(has)

  const sttKeys = ['stt', 'moderation_nls', 'similarity', 'speaker_annotate']
  const ttsNodes: FlowNode[] = [stageNode('tts_main', '主音频 TTS', statuses)]
  const nlsDecision: FlowDecision = {
    kind: 'decision',
    key: 'nls',
    question: '是否开启 NLS 语音校对？',
    branches: [
      {
        key: 'on',
        label: '开启 NLS → 识别/转写审核/相似度/说话人标注',
        taken: nlsOn,
        status: branchTakenStatus(nlsOn, sttKeys.map((k) => stageNode(k, STT_LABEL[k] ?? k, statuses))),
        nodes: sttKeys.map((k) => stageNode(k, STT_LABEL[k] ?? k, statuses)),
      },
      {
        key: 'off',
        label: '未开启（直接用用户音频）',
        taken: !nlsOn,
        status: branchTakenStatus(!nlsOn, []),
        nodes: [],
      },
    ],
  }
  const userNodes: FlowNode[] = [nlsDecision]
  const audioSource: FlowDecision = {
    kind: 'decision',
    key: 'audio_source',
    question: '主音频来源',
    branches: [
      {
        key: 'tts',
        label: '无用户音频 → 主音频 TTS',
        taken: ttsTaken,
        status: branchTakenStatus(ttsTaken, ttsNodes),
        nodes: ttsNodes,
      },
      {
        key: 'user',
        label: '有用户音频',
        taken: userTaken,
        status: branchTakenStatus(userTaken, userNodes),
        nodes: userNodes,
      },
    ],
  }

  return [
    stageNode('moderation_text', '文本内容审核', statuses),
    audioSource,
    stageNode('ai_content', 'AI 内容生成', statuses),
    stageNode('title', '标题生成', statuses),
    stageNode('vocab_tts', '词汇音频生成', statuses),
    stageNode('persist', '入库', statuses),
  ]
}

const STT_LABEL: Record<string, string> = {
  stt: 'NLS 识别',
  moderation_nls: '音频文本审核',
  similarity: '音文相似度',
  speaker_annotate: '说话人标注',
}