/** Segment 配音/跟读排行榜（GET /api/segment/:segId/leaderboard） */

/** 榜单单行（Top50 内） */
export interface SegmentLeaderboardEntry {
  rank: number
  /** 昵称（为空时服务端回退为打码账号，原始账号不出网） */
  nickname: string
  avatarUrl: string | null
  bestScore: number
  /** 取得最佳成绩那次录音的时间（同分取最早达成） */
  achievedAt: string
  isMe: boolean
}

/** 当前用户名次（无成绩为 null） */
export interface SegmentLeaderboardMe {
  rank: number
  bestScore: number
  achievedAt: string
}

/** 单阶段榜单 */
export interface SegmentLeaderboardBoard {
  list: SegmentLeaderboardEntry[]
  me: SegmentLeaderboardMe | null
}

/** 排行榜聚合响应：一次下发两阶段，tab 切换零请求 */
export interface SegmentLeaderboard {
  segment: {
    id: number
    title: string
    unitId: number
  }
  phase3: SegmentLeaderboardBoard
  phase4: SegmentLeaderboardBoard
}
