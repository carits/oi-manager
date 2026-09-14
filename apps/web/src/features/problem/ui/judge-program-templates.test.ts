import { describe, expect, it } from 'vitest'
import { getJudgeProgramTemplate, JUDGE_PROGRAM_CAPABILITIES, JUDGE_PROGRAM_TEMPLATES, parseGeneratorContext } from '@oi-manager/shared'

describe('judge program editor contract', () => {
  it('always provides a complete teaching bundle for every capability', () => {
    for (const [kind, capability] of Object.entries(JUDGE_PROGRAM_CAPABILITIES)) {
      for (const language of Object.keys(capability.languages)) {
        const template = getJudgeProgramTemplate(language === 'validator-dsl' ? 'validator-dsl-v1' : `${kind}-${language}-v1`)
        expect(template?.source.trim(), `${kind}/${language}`).toBeTruthy()
        expect(template?.protocolHelp.length).toBeGreaterThan(0)
        expect(template?.examples.length).toBeGreaterThan(0)
        expect(template?.learningNotes.length).toBeGreaterThan(0)
        expect(template?.requiredChanges.length).toBeGreaterThan(0)
      }
    }
    expect(JUDGE_PROGRAM_TEMPLATES).toHaveLength(8)
  })

  it('loads Generator source, schema, profiles and deterministic Context fixtures as one package', () => {
    for (const language of ['cpp17', 'python3']) {
      const template = getJudgeProgramTemplate(`generator-${language}-v1`)
      expect(template?.protocol).toBe('oj.generator/v1')
      expect(Object.keys(template?.protocolConfig?.parameterSchema || {})).toEqual(['nMin', 'nMax'])
      expect(template?.protocolConfig?.profiles.map(item => item.id)).toEqual(['random', 'max'])
      expect(template?.examples.map(item => parseGeneratorContext(item.stdin).profile)).toEqual(['random', 'max'])
    }
  })

  it('provides explicit positive and negative Validator fixtures and overlapping Classifier fixtures', () => {
    for (const language of ['validator-dsl', 'cpp17', 'python3']) {
      const fixtures = getJudgeProgramTemplate(language === 'validator-dsl' ? 'validator-dsl-v1' : `validator-${language}-v1`)?.examples || []
      expect(fixtures.some(item => item.expectedExitCode === 0)).toBe(true)
      expect(fixtures.filter(item => item.expectedExitCode !== 0).map(item => item.name)).toEqual(expect.arrayContaining(['越界 n', '少一个数组元素', '多余 Token']))
    }
    for (const language of ['cpp17', 'python3']) {
      const fixtures = getJudgeProgramTemplate(`classifier-${language}-v1`)?.examples || []
      expect(fixtures.some(item => item.expectedSubtasks?.length === 1)).toBe(true)
      expect(fixtures.some(item => (item.expectedSubtasks?.length || 0) > 1)).toBe(true)
    }
  })
})
