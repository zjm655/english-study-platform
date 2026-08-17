<template>
  <svg :viewBox="`0 0 ${diagram.width} ${diagram.height}`" class="flow-svg" role="img" aria-label="材料上传流水线流程图">
    <defs>
      <marker id="flow-arrow-reached" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto" markerUnits="userSpaceOnUse">
        <path d="M0,0 L7,3 L0,6 Z" class="flow-arrow-reached" />
      </marker>
    </defs>

    <!-- 泳道背景 -->
    <g v-for="lane in diagram.lanes" :key="lane.index">
      <rect
        :x="0"
        :y="lane.y"
        :width="diagram.width"
        :height="lane.h"
        class="flow-lane-bg"
      />
      <text :x="10" :y="lane.y + 20" class="flow-lane-label">{{ lane.label }}</text>
    </g>

    <!-- 泳道分隔线 -->
    <line
      v-for="lane in diagram.lanes.slice(1)"
      :key="'sep' + lane.index"
      :x1="0"
      :y1="lane.y"
      :x2="diagram.width"
      :y2="lane.y"
      class="flow-lane-sep"
    />

    <!-- 边 -->
    <g v-for="edge in diagram.edges" :key="edge.id">
      <polyline
        fill="none"
        class="flow-edge"
        :class="{ 'flow-edge--reached': edge.reached, 'flow-edge--off': !edge.reached }"
        :points="pointsOf(edge.points)"
        :marker-end="edge.reached ? 'url(#flow-arrow-reached)' : undefined"
      />
      <g
        v-if="edge.label"
        :transform="`translate(${edgeBarPos(edge).x}, ${edgeBarPos(edge).y})`"
        class="flow-edge-label"
      >
        <rect :x="-4" :y="-13" :width="edge.label.length * 12 + 8" :height="20" rx="4" class="flow-edge-label-bg" />
        <text x="0" y="1" class="flow-edge-label-text">{{ edge.label }}</text>
      </g>
    </g>

    <!-- 节点 -->
    <g
      v-for="node in diagram.nodes"
      :key="node.id"
      :transform="`translate(${node.x}, ${node.y})`"
      class="flow-node-g"
    >
      <template v-if="node.kind === 'decision'">
        <polygon :points="diamondPoints(node)" class="flow-shape" :class="nodeClass(node)" />
        <text :x="node.w / 2" :y="node.h / 2" class="flow-text" text-anchor="middle">
          {{ node.label }}
        </text>
      </template>
      <template v-else>
        <rect
          :x="0"
          :y="0"
          :width="node.w"
          :height="node.h"
          :rx="node.kind === 'start' || node.kind === 'end' ? 22 : 6"
          class="flow-shape"
          :class="nodeClass(node)"
        />
        <text :x="node.w / 2" :y="node.h / 2 + 1" class="flow-text" text-anchor="middle">
          {{ node.label }}
        </text>
        <circle
          v-if="node.id === diagram.failedNodeId"
          :cx="node.w - 8"
          :cy="8"
          r="8"
          class="flow-fail-badge"
        >
          <title>流程在此终止</title>
        </circle>
        <text
          v-if="node.id === diagram.failedNodeId"
          :x="node.w - 8"
          :y="12"
          text-anchor="middle"
          class="flow-fail-x"
        >
          ✕
        </text>
      </template>
    </g>
  </svg>
</template>

<script setup lang="ts">
import type { FlowDiagram, FlowPoint } from '~/utils/flowLayout'

defineProps<{ diagram: FlowDiagram }>()

function pointsOf(points: FlowPoint[]) {
  return points.map((p) => `${p.x},${p.y}`).join(' ')
}

function diamondPoints(node: { x: number; y: number; w: number; h: number }) {
  const cx = node.w / 2
  const cy = node.h / 2
  return `${cx},0 ${node.w},${cy} ${cx},${node.h} 0,${cy}`
}

const STATUS_FILL: Record<string, string> = {
  success: 'is-success',
  failed: 'is-failed',
  exception: 'is-exception',
  not_started: 'is-off',
}
function nodeClass(node: { status: string; reached: boolean }) {
  const base = STATUS_FILL[node.status] ?? 'is-off'
  // 未到达（未执行）→ 统一置灰弱化
  return [base, node.reached ? '' : 'is-unreached'].filter(Boolean).join(' ')
}

/** 分支文案锚点：优先显式锚点，否则取边的水平段中点 */
function edgeBarPos(edge: { labelAnchor?: FlowPoint; points: FlowPoint[] }) {
  if (edge.labelAnchor) return edge.labelAnchor
  const pts = edge.points
  if (pts.length >= 2) {
    // 找最长水平段
    for (let i = 1; i < pts.length; i++) {
      if (pts[i]!.y === pts[i - 1]!.y) {
        return { x: Math.round((pts[i]!.x + pts[i - 1]!.x) / 2), y: pts[i]!.y - 6 }
      }
    }
    return { x: Math.round((pts[0]!.x + pts[1]!.x) / 2), y: pts[0]!.y - 8 }
  }
  return { x: pts[0]!.x, y: pts[0]!.y }
}
</script>

<style scoped>
.flow-svg {
  width: 100%;
  max-width: 760px;
  display: block;
}
.flow-lane-bg {
  fill: var(--el-fill-color-light);
  opacity: 0.5;
}
.flow-lane-sep {
  stroke: var(--el-border-color-lighter);
  stroke-width: 1;
  stroke-dasharray: 4 3;
}
.flow-lane-label {
  font-size: 12px;
  font-weight: 700;
  fill: var(--text-3);
}
.flow-arrow-reached {
  fill: var(--text-2);
}
.flow-edge--reached {
  stroke: var(--text-2);
  stroke-width: 1.5;
}
.flow-edge--off {
  stroke: var(--el-border-color);
  stroke-width: 1.2;
  stroke-dasharray: 5 4;
}
.flow-edge-label-bg {
  fill: var(--el-fill-color-light);
  stroke: var(--el-border-color-lighter);
}
.flow-edge-label-text {
  font-size: 11px;
  fill: var(--text-2);
}
.flow-shape {
  stroke-width: 1.5;
}
.flow-node-g text {
  font-size: 13px;
  dominant-baseline: middle;
}
.flow-text {
  fill: var(--text-1);
}
.is-success {
  fill: var(--el-color-success-light-9);
  stroke: var(--el-color-success);
}
.is-failed {
  fill: var(--el-color-danger-light-8);
  stroke: var(--el-color-danger);
}
.is-exception {
  fill: var(--el-color-warning-light-9);
  stroke: var(--el-color-warning);
}
.is-off {
  fill: var(--el-color-info-light-8);
  stroke: var(--el-border-color);
}
.is-unreached {
  opacity: 0.45;
}
.flow-fail-badge {
  fill: var(--el-color-danger);
}
.flow-fail-x {
  fill: #fff;
  font-size: 11px;
  font-weight: 700;
  dominant-baseline: middle;
}

/* 深色主题适配：节点/泳道/边标签底色默认是浅色 pastel，而深色下 --text-*
   文字变浅，白字配浅底看不清。这里将底色加深，让浅色文字恢复对比度。 */
[data-theme='dark'] .flow-lane-bg {
  fill: #1b1b30;
}
[data-theme='dark'] .flow-lane-sep {
  stroke: var(--border);
}
[data-theme='dark'] .flow-edge-label-bg {
  fill: #26264a;
  stroke: var(--border);
}
[data-theme='dark'] .is-success {
  fill: var(--success-light);
}
[data-theme='dark'] .is-failed {
  fill: var(--danger-light);
}
[data-theme='dark'] .is-exception {
  fill: var(--warning-light);
}
[data-theme='dark'] .is-off {
  fill: #2a2a4a;
}
</style>