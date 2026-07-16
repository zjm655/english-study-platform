import type { RecordingRow } from '#server/types/db'
import type { Recording, WordScore } from '#shared/types/recording'

/** 将数据库行转为前端 Recording 类型（支持音频路径覆盖，用于 media 表签名后） */
export function rowToRecording(
  row: RecordingRow | undefined,
  audioPathOverride?: string | null
): Recording | null {
  if (!row) return null
  let wordScores: WordScore[] | null = null
  if (row.wordScores) {
    try {
      wordScores = JSON.parse(row.wordScores)
    } catch {
      wordScores = null
    }
  }
  return {
    id: row.id,
    userId: row.user_id,
    segmentId: row.segment_id,
    phase: row.phase,
    audioPath: audioPathOverride ?? row.audioPath,
    score: row.score !== null ? Number(row.score) : null,
    feedback: row.feedback,
    recognizedText: row.recognizedText,
    wordScores,
    duration: row.duration !== null ? Number(row.duration) : null,
    createdAt: row.createdAt,
  }
}