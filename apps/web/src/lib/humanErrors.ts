const ERROR_MESSAGES: Record<string, string> = {
  FORBIDDEN: '你没有权限完成这项操作。',
  UNAUTHORIZED: '登录已失效，请重新登录。',
  NOT_FOUND: '要查找的内容不存在，或已不再可见。',
  TRAINING_SESSION_STALE: '训练已被其他管理员修改，请刷新后再保存。',
  TEST_SET_REVISION_STALE: '评测数据已有更新，你的草稿仍已保留，请刷新后核对。',
  TEST_SET_REVISION_FROZEN: '该活动已开始或已有提交，不能再更换评测数据。',
  ASSIGNMENT_PROGRESS_STALE: '该学生的作业状态已更新，请刷新后重试。',
  MANUAL_COMPLETION_STALE: '人工完成状态已被修改，你填写的原因仍会保留。',
  VALIDATOR_NOT_ACTIVE: '题目还没有启用输入检查程序，暂时不能贡献数据。',
  STD_NOT_ACTIVE: '题目还没有启用标准答案程序，暂时不能贡献数据。',
  EVALUATION_BUDGET_EXCEEDED: '今日评测额度已用完，请在额度恢复后重试。',
  CARITS_BALANCE_INSUFFICIENT: 'Carits 余额不足。',
  IDEMPOTENCY_KEY_REUSED: '该请求标识已用于另一次操作，请重新提交。',
  RATE_LIMITED: '操作过于频繁，请稍后重试。',
}

export function humanErrorMessage(code?: string, _debugMessage?: string, status?: number) {
  if (code && ERROR_MESSAGES[code]) return ERROR_MESSAGES[code]
  if (status === 401) return ERROR_MESSAGES.UNAUTHORIZED
  if (status === 403) return ERROR_MESSAGES.FORBIDDEN
  if (status === 404) return ERROR_MESSAGES.NOT_FOUND
  if (status === 429) return ERROR_MESSAGES.RATE_LIMITED
  return status && status >= 500 ? '服务暂时不可用，请稍后重试。' : '操作未完成，请检查后重试。'
}

export function publicErrorMessage(error: unknown, fallback: string) {
  if (error && typeof error === 'object') {
    const candidate = error as { userMessage?: unknown; code?: unknown; status?: unknown }
    if (typeof candidate.userMessage === 'string' && candidate.userMessage.trim()) return candidate.userMessage
    const code = typeof candidate.code === 'string' ? candidate.code : undefined
    const status = typeof candidate.status === 'number' ? candidate.status : undefined
    if ((code && ERROR_MESSAGES[code]) || status === 401 || status === 403 || status === 404 || status === 429 || (status != null && status >= 500)) {
      return humanErrorMessage(code, undefined, status)
    }
  }
  if (error != null) console.error(error)
  return fallback
}
