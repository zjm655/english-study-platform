/**
 * 材料上传流水线快照构建器（server-only，纯内存无副作用）
 *
 * admin（adminUpload）与 user（materialJob）两条流水线共用：
 * 到达各阶段即 add() 记录结果，失败/成功终端机一次 toJSON() 写入 material_upload_record.pipeline_snapshot。
 */

/** 单个阶段记录 */
export interface PipelineStage {
  /** 阶段名（如 moderation_text / stt / moderation_nls / speaker_annotate / tts_main / ai_content / title） */
  name: string
  /** 是否通过 */
  ok: boolean
  /** 阶段产物摘要（如 { safe, reason } / { text } / { vocabCount, questionCount }） */
  detail?: Record<string, unknown> | null
  /** 阶段临时失败错误（ok=false 时的错误） */
  error?: string | null
}

/** 快照结构（落库 前由 toJSON 序列化） */
export interface PipelineSnapshot {
  stages: PipelineStage[]
  /** 最终失败点（失败终端置为对应阶段名，成功为 null） */
  failedAt?: string | null
  /** 最终失败原因（成功为 null） */
  finalError?: string | null
}

export class PipelineSnapshotBuilder {
  private snapshot: PipelineSnapshot = { stages: [] }

  /** 记录一个阶段结果 */
  add(
    name: string,
    ok: boolean,
    detail?: Record<string, unknown> | null,
    error?: string | null,
  ): void {
    this.snapshot.stages.push({ name, ok, detail: detail ?? null, error: error ?? null })
  }

  /** 标记最终失败点与原因 */
  setFailed(name: string, finalError: string): void {
    this.snapshot.failedAt = name
    this.snapshot.finalError = finalError
  }

  /** 序列化为落库 JSON（含 stages/failedAt/finalError） */
  toJSON(): string {
    return JSON.stringify(this.snapshot)
  }
}
