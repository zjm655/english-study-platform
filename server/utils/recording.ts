import type { RecordingRow } from '#server/types/db'
import type { Recording, WordScore } from '#shared/types/recording'

/** 将数据库行转为前端 Recording 类型 */
export function rowToRecording(row: RecordingRow | undefined): Recording | null {
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
    audioPath: row.audioPath,
    score: row.score !== null ? Number(row.score) : null,
    feedback: row.feedback,
    recognizedText: row.recognizedText,
    wordScores,
    duration: row.duration !== null ? Number(row.duration) : null,
    createdAt: row.createdAt,
  }
}
