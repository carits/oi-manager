export type BuiltinTrainingTemplate = {
  key: string
  name: string
  sessionType: 'OI' | 'ACM' | 'GENERAL'
  description: string
  stages: Array<{
    name: string
    description: string
    kind: 'TRAINING' | 'TEACHING' | 'REVIEW'
    audienceMode: 'ALL' | 'GROUPED'
    plannedDurationSeconds?: number
    endPolicy: 'MANUAL' | 'TIME' | 'COMPLETION' | 'HYBRID'
    accessPolicy: 'ALL_AT_ONCE' | 'SEQUENTIAL' | 'TEACHER_CONTROLLED'
    submissionMode: 'ENABLED' | 'DISABLED'
    defaultTargetScore?: number
    rules?: Record<string, unknown>
    groups?: Array<{ clientKey: string; name: string; accessPolicy?: 'ALL_AT_ONCE' | 'SEQUENTIAL' | 'TEACHER_CONTROLLED' }>
  }>
}

export const BUILTIN_TRAINING_TEMPLATES: BuiltinTrainingTemplate[] = [
  {
    key: 'simple-practice', name: '简单刷题', sessionType: 'GENERAL', description: '一个全班统一、全部开放的训练阶段。',
    stages: [{ name: '训练', description: '按自己的节奏完成训练题', kind: 'TRAINING', audienceMode: 'ALL', endPolicy: 'MANUAL', accessPolicy: 'ALL_AT_ONCE', submissionMode: 'ENABLED' }],
  },
  {
    key: 'teach-and-practice', name: '讲练结合', sessionType: 'GENERAL', description: '独立训练、统一讲解、继续训练。',
    stages: [
      { name: '独立训练', description: '先独立思考并提交', kind: 'TRAINING', audienceMode: 'ALL', plannedDurationSeconds: 1800, endPolicy: 'MANUAL', accessPolicy: 'ALL_AT_ONCE', submissionMode: 'ENABLED' },
      { name: '统一讲解', description: '暂停提交，由教练讲解', kind: 'TEACHING', audienceMode: 'ALL', plannedDurationSeconds: 600, endPolicy: 'TIME', accessPolicy: 'TEACHER_CONTROLLED', submissionMode: 'DISABLED' },
      { name: '继续训练', description: '根据讲解继续完成题目', kind: 'REVIEW', audienceMode: 'ALL', endPolicy: 'MANUAL', accessPolicy: 'ALL_AT_ONCE', submissionMode: 'ENABLED' },
    ],
  },
  {
    key: 'layered-classroom', name: '分层课堂', sessionType: 'GENERAL', description: '全班热身、分层训练、讲解、重新分层和补题。',
    stages: [
      { name: '全班热身', description: '完成基础热身题', kind: 'TRAINING', audienceMode: 'ALL', plannedDurationSeconds: 600, endPolicy: 'TIME', accessPolicy: 'ALL_AT_ONCE', submissionMode: 'ENABLED' },
      { name: '第一次分层', description: '按当前学习目标分组训练', kind: 'TRAINING', audienceMode: 'GROUPED', plannedDurationSeconds: 2100, endPolicy: 'MANUAL', accessPolicy: 'ALL_AT_ONCE', submissionMode: 'ENABLED', groups: [{ clientKey: 'foundation', name: '基础组', accessPolicy: 'SEQUENTIAL' }, { clientKey: 'advanced', name: '提高组' }] },
      { name: '统一讲解', description: '全班讲解共性问题', kind: 'TEACHING', audienceMode: 'ALL', plannedDurationSeconds: 900, endPolicy: 'TIME', accessPolicy: 'TEACHER_CONTROLLED', submissionMode: 'DISABLED' },
      { name: '第二次分层', description: '根据上一阶段表现重新分组', kind: 'TRAINING', audienceMode: 'GROUPED', plannedDurationSeconds: 1800, endPolicy: 'MANUAL', accessPolicy: 'ALL_AT_ONCE', submissionMode: 'ENABLED', groups: [{ clientKey: 'foundation-2', name: '基础巩固' }, { clientKey: 'advanced-2', name: '提高训练' }] },
      { name: '自由补题', description: '完成前面尚未解决的题目', kind: 'REVIEW', audienceMode: 'ALL', plannedDurationSeconds: 600, endPolicy: 'MANUAL', accessPolicy: 'ALL_AT_ONCE', submissionMode: 'ENABLED' },
    ],
  },
  {
    key: 'oi-score-progressive', name: 'OI 部分分训练', sessionType: 'OI', description: '在同一 Stage 内按 30、60、100 分递进，不人为拆分课堂阶段。',
    stages: [{ name: '部分分训练', description: '逐步优化同一道题', kind: 'TRAINING', audienceMode: 'ALL', endPolicy: 'MANUAL', accessPolicy: 'ALL_AT_ONCE', submissionMode: 'ENABLED', rules: { defaultScoreGoals: [{ score: 30 }, { score: 60 }, { score: 100 }] } }],
  },
  {
    key: 'acm-strategy', name: 'ACM 策略训练', sessionType: 'ACM', description: '扫题、主攻和自由训练。',
    stages: [
      { name: '扫题', description: '快速评估所有题目', kind: 'TRAINING', audienceMode: 'ALL', plannedDurationSeconds: 900, endPolicy: 'TIME', accessPolicy: 'ALL_AT_ONCE', submissionMode: 'ENABLED' },
      { name: '主攻', description: '围绕主攻题训练切题决策', kind: 'TRAINING', audienceMode: 'ALL', plannedDurationSeconds: 1800, endPolicy: 'MANUAL', accessPolicy: 'TEACHER_CONTROLLED', submissionMode: 'ENABLED', rules: { strategyIntervalSeconds: 900, timePolicy: { mode: 'SOFT', limitSeconds: 1800 }, stuckPolicy: { minActiveSeconds: 1200, minAttempts: 3, noImprovementSeconds: 600 } } },
      { name: '自由训练', description: '开放全部训练题', kind: 'REVIEW', audienceMode: 'ALL', endPolicy: 'MANUAL', accessPolicy: 'ALL_AT_ONCE', submissionMode: 'ENABLED' },
    ],
  },
]

export function getBuiltinTrainingTemplate(key: string | null | undefined) {
  return BUILTIN_TRAINING_TEMPLATES.find(item => item.key === key) || null
}
