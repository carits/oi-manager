import yaml from 'js-yaml'

export type JudgeMode = 'acm' | 'oi'

export function resolveJudgePresentationConfig(configText: string | null | undefined): { mode: JudgeMode } {
  if (!configText) return { mode: 'acm' }
  try {
    const config = yaml.load(configText) as Record<string, unknown> | null
    if (config?.mode === 'oi') return { mode: 'oi' }
    if (config?.mode === 'acm') return { mode: 'acm' }
    return { mode: Array.isArray(config?.subtasks) && config.subtasks.length > 0 ? 'oi' : 'acm' }
  } catch {
    return { mode: 'acm' }
  }
}
