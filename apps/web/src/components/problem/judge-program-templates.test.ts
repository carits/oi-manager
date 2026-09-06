import { describe, expect, it } from 'vitest'
import { getJudgeProgramTemplate, JUDGE_PROGRAM_CAPABILITIES } from '@oi-manager/shared'

describe('judge program editor contract', () => {
  it('always provides an in-editor template for every code capability', () => {
    for (const [kind, capability] of Object.entries(JUDGE_PROGRAM_CAPABILITIES)) {
      for (const language of Object.keys(capability.languages).filter(item => item !== 'validator-dsl')) {
        const template = getJudgeProgramTemplate(`${kind}-${language}-v1`)
        expect(template?.source.trim(), `${kind}/${language}`).toBeTruthy()
        expect(template?.protocolHelp.length).toBeGreaterThan(0)
      }
    }
  })

  it('teaches contributors deterministic generator IO in both languages', () => {
    for (const language of ['cpp17', 'python3']) {
      const template = getJudgeProgramTemplate(`generator-${language}-v1`)
      expect(template?.protocol).toBe('oj.generator/v1')
      expect(template?.examples[0]?.stdin).toContain('"seed"')
    }
  })
})
