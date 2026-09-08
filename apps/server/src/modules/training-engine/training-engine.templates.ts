export type BuiltinTrainingTemplate = {
  key: string
  name: string
  sessionType: 'OI' | 'ACM' | 'GENERAL'
  description: string
  stages: Array<{
    name: string
    description: string
    mode: 'FREE' | 'SEQUENTIAL' | 'FOCUS' | 'SCORE_PROGRESSIVE' | 'TEACHING' | 'REVIEW'
    durationSeconds?: number
    advanceMode: 'MANUAL' | 'TIME' | 'COMPLETION' | 'HYBRID'
    problemAccessMode: 'ALL' | 'STAGE_ONLY' | 'SEQUENTIAL' | 'FOCUS_ONLY'
    submissionMode: 'ENABLED' | 'DISABLED'
    targetScore?: number
    rules?: Record<string, unknown>
  }>
}

export const BUILTIN_TRAINING_TEMPLATES: BuiltinTrainingTemplate[] = [
  {
    key: 'oi-standard', name: 'OI 标准训练', sessionType: 'OI', description: '热身、单题攻坚、讲评和自由补题。',
    stages: [
      { name: '热身', description: '完成基础题并熟悉环境', mode: 'FREE', durationSeconds: 600, advanceMode: 'TIME', problemAccessMode: 'STAGE_ONLY', submissionMode: 'ENABLED' },
      { name: '核心训练', description: '按安排完成核心题', mode: 'SEQUENTIAL', durationSeconds: 3600, advanceMode: 'MANUAL', problemAccessMode: 'SEQUENTIAL', submissionMode: 'ENABLED' },
      { name: '统一讲评', description: '暂停提交，由教练讲解', mode: 'TEACHING', durationSeconds: 600, advanceMode: 'TIME', problemAccessMode: 'STAGE_ONLY', submissionMode: 'DISABLED' },
      { name: '自由补题', description: '恢复全部训练题', mode: 'REVIEW', advanceMode: 'MANUAL', problemAccessMode: 'ALL', submissionMode: 'ENABLED' },
    ],
  },
  {
    key: 'oi-score-progressive', name: 'OI 部分分训练', sessionType: 'OI', description: '按 30、60、100 分逐步优化同一题。',
    stages: [
      { name: '目标 30 分', description: '先完成可控范围算法', mode: 'SCORE_PROGRESSIVE', targetScore: 30, advanceMode: 'COMPLETION', problemAccessMode: 'STAGE_ONLY', submissionMode: 'ENABLED' },
      { name: '目标 60 分', description: '扩展算法适用范围', mode: 'SCORE_PROGRESSIVE', targetScore: 60, advanceMode: 'COMPLETION', problemAccessMode: 'STAGE_ONLY', submissionMode: 'ENABLED' },
      { name: '目标 100 分', description: '完成完整算法和边界处理', mode: 'SCORE_PROGRESSIVE', targetScore: 100, advanceMode: 'COMPLETION', problemAccessMode: 'STAGE_ONLY', submissionMode: 'ENABLED' },
    ],
  },
  {
    key: 'acm-sequential', name: 'ACM 顺序训练', sessionType: 'ACM', description: '按固定顺序解锁题目，训练知识路径。',
    stages: [{ name: '顺序训练', description: 'AC 后解锁下一题', mode: 'SEQUENTIAL', advanceMode: 'MANUAL', problemAccessMode: 'SEQUENTIAL', submissionMode: 'ENABLED', rules: { defaultUnlock: { mode: 'ANY', conditions: [{ type: 'AC' }] } } }],
  },
  {
    key: 'acm-strategy', name: 'ACM 策略训练', sessionType: 'ACM', description: '扫题、主攻、切题检查和自由训练。',
    stages: [
      { name: '自由扫题', description: '评估所有题目', mode: 'FREE', durationSeconds: 900, advanceMode: 'TIME', problemAccessMode: 'ALL', submissionMode: 'ENABLED' },
      { name: '主攻题', description: '每 15 分钟重新评估策略', mode: 'FOCUS', durationSeconds: 1800, advanceMode: 'MANUAL', problemAccessMode: 'STAGE_ONLY', submissionMode: 'ENABLED', rules: { strategyIntervalSeconds: 900, maxContinuousWorkSeconds: 1800 } },
      { name: '自由训练', description: '开放全部题目', mode: 'FREE', advanceMode: 'MANUAL', problemAccessMode: 'ALL', submissionMode: 'ENABLED' },
    ],
  },
  {
    key: 'classroom-focus', name: '课堂统一训练', sessionType: 'GENERAL', description: '全员聚焦、统一讲解、恢复个人进度。',
    stages: [
      { name: '个人尝试', description: '先独立思考', mode: 'FREE', durationSeconds: 1200, advanceMode: 'MANUAL', problemAccessMode: 'STAGE_ONLY', submissionMode: 'ENABLED' },
      { name: '全员攻坚', description: '教练通过 Focus Overlay 指定题目', mode: 'FOCUS', durationSeconds: 1800, advanceMode: 'MANUAL', problemAccessMode: 'FOCUS_ONLY', submissionMode: 'ENABLED' },
      { name: '讲解', description: '禁止提交并统一讲解', mode: 'TEACHING', durationSeconds: 600, advanceMode: 'TIME', problemAccessMode: 'STAGE_ONLY', submissionMode: 'DISABLED' },
    ],
  },
]

export function getBuiltinTrainingTemplate(key: string | null | undefined) {
  return BUILTIN_TRAINING_TEMPLATES.find(item => item.key === key) || null
}
