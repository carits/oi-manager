/**
 * Training Module - Type Definitions
 * 训练模块类型定义
 */

/** 训练赛制 */
export type TrainingFormat = 'ioi' | 'icpc'

/** 训练状态 */
export type TrainingStatus = 'upcoming' | 'ongoing' | 'finished'

/** 排名条目 */
export interface RankingEntry {
  userId: string
  name: string
  username: string
  totalScore: number
  lastSubmitAt: string
  problems: Record<string, { score: number; alias: string }>
}

/** ICPC 排名条目 */
export interface ICPCRankingEntry {
  userId: string
  name: string
  username: string
  solved: number
  penalty: number
  problems: Record<string, { solved: boolean; attempts: number; time: number; alias: string }>
}
