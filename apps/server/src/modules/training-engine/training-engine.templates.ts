export type TrainingTemplateStage = {
  name: string
  description: string
  kind: 'TRAINING' | 'TEACHING' | 'REVIEW'
  plannedDurationSeconds?: number
  endPolicy: 'MANUAL' | 'TIME' | 'COMPLETION' | 'HYBRID'
  accessPolicy: 'ALL_AT_ONCE' | 'SEQUENTIAL' | 'TEACHER_CONTROLLED'
  submissionMode: 'ENABLED' | 'DISABLED'
  rules?: Record<string, unknown>
}

export type TrainingTemplate = {
  key: string
  name: string
  sessionType: 'OI' | 'ACM' | 'GENERAL'
  description: string
  stages: TrainingTemplateStage[]
}

export const BUILTIN_TRAINING_TEMPLATES: TrainingTemplate[] = [
  {
    key: 'simple-practice', name: '简单刷题', sessionType: 'GENERAL',
    description: '一个阶段的全体训练，并为全班准备完整的阶段训练方案。',
    stages: [{ name: '训练', description: '按自己的节奏完成训练题', kind: 'TRAINING', endPolicy: 'MANUAL', accessPolicy: 'ALL_AT_ONCE', submissionMode: 'ENABLED' }],
  },
  {
    key: 'teach-practice', name: '讲练结合', sessionType: 'GENERAL', description: '训练、讲解、继续训练的时间轴骨架。',
    stages: [
      { name: '独立训练', description: '先独立思考并提交', kind: 'TRAINING', plannedDurationSeconds: 1800, endPolicy: 'MANUAL', accessPolicy: 'ALL_AT_ONCE', submissionMode: 'ENABLED' },
      { name: '统一讲解', description: '暂停提交，由教练讲解', kind: 'TEACHING', plannedDurationSeconds: 600, endPolicy: 'TIME', accessPolicy: 'TEACHER_CONTROLLED', submissionMode: 'DISABLED' },
      { name: '继续训练', description: '根据讲解继续完成题目', kind: 'REVIEW', endPolicy: 'MANUAL', accessPolicy: 'ALL_AT_ONCE', submissionMode: 'ENABLED' },
    ],
  },
  {
    key: 'layered-class', name: '分层课堂', sessionType: 'GENERAL', description: '先创建稳定训练组，再为各阶段配置不同的分组训练方案。',
    stages: [
      { name: '全班热身', description: '完成基础热身题', kind: 'TRAINING', plannedDurationSeconds: 600, endPolicy: 'TIME', accessPolicy: 'ALL_AT_ONCE', submissionMode: 'ENABLED' },
      { name: '第一次分层', description: '按当前学习目标分组训练', kind: 'TRAINING', plannedDurationSeconds: 2100, endPolicy: 'MANUAL', accessPolicy: 'ALL_AT_ONCE', submissionMode: 'ENABLED' },
      { name: '统一讲解', description: '全班讲解共性问题', kind: 'TEACHING', plannedDurationSeconds: 900, endPolicy: 'TIME', accessPolicy: 'TEACHER_CONTROLLED', submissionMode: 'DISABLED' },
      { name: '第二次分层', description: '根据上一阶段表现重新分组', kind: 'TRAINING', plannedDurationSeconds: 1800, endPolicy: 'MANUAL', accessPolicy: 'ALL_AT_ONCE', submissionMode: 'ENABLED' },
      { name: '自由补题', description: '完成前面尚未解决的题目', kind: 'REVIEW', plannedDurationSeconds: 600, endPolicy: 'MANUAL', accessPolicy: 'ALL_AT_ONCE', submissionMode: 'ENABLED' },
    ],
  },
  {
    key: 'oi-score-progressive', name: 'OI 部分分', sessionType: 'OI', description: '同一阶段内按 30、60、100 分目标逐步优化。',
    stages: [{ name: '部分分训练', description: '逐步优化同一道题', kind: 'TRAINING', endPolicy: 'MANUAL', accessPolicy: 'ALL_AT_ONCE', submissionMode: 'ENABLED', rules: { defaultScoreGoals: [{ score: 30 }, { score: 60 }, { score: 100 }] } }],
  },
  {
    key: 'acm-strategy', name: 'ACM 策略训练', sessionType: 'ACM', description: '扫题、主攻、自由训练的策略时间轴。',
    stages: [
      { name: '扫题', description: '快速评估所有题目', kind: 'TRAINING', plannedDurationSeconds: 900, endPolicy: 'TIME', accessPolicy: 'ALL_AT_ONCE', submissionMode: 'ENABLED' },
      { name: '主攻', description: '围绕主攻题训练切题决策', kind: 'TRAINING', plannedDurationSeconds: 1800, endPolicy: 'MANUAL', accessPolicy: 'TEACHER_CONTROLLED', submissionMode: 'ENABLED', rules: { strategyIntervalSeconds: 900, accessScope: 'CURRENT_STAGE', timePolicy: { mode: 'RECOMMEND_SWITCH', action: 'RECOMMEND_SWITCH', limitSeconds: 1800 }, stuckPolicy: { minActiveSeconds: 1200, minAttempts: 3, noImprovementSeconds: 600 } } },
      { name: '自由训练', description: '开放全部训练题', kind: 'REVIEW', endPolicy: 'MANUAL', accessPolicy: 'ALL_AT_ONCE', submissionMode: 'ENABLED' },
    ],
  },
]

export function getBuiltinTrainingTemplate(key?: string | null) {
  return BUILTIN_TRAINING_TEMPLATES.find(template => template.key === key) || null
}