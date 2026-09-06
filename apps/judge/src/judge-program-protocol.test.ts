import { describe, expect, it } from 'vitest'
import { ClassifierProtocolError, getJudgeProgramTemplate, isJudgeProgramCombinationAllowed, parseClassifierOutput } from '@oi-manager/shared'

describe('judge program protocol registry', () => {
  it('exposes stable in-editor templates and rejects mismatched capabilities', () => {
    expect(getJudgeProgramTemplate('generator-python3-v1')?.protocol).toBe('oj.generator/v1')
    expect(getJudgeProgramTemplate('validator-cpp17-v1')?.source).toContain('readEof')
    expect(isJudgeProgramCombinationAllowed('validator', 'python3', 'oj.validator/v1')).toBe(true)
    expect(isJudgeProgramCombinationAllowed('validator', 'python3', 'oj.generator/v1')).toBe(false)
  })

  it('accepts only the strict Classifier output schema', () => {
    expect(parseClassifierOutput('{"subtasks":[3,1]}', [1, 2, 3])).toEqual([1, 3])
    for (const output of ['not-json', '{}', '{"subtasks":[]}', '{"subtasks":[1,1]}', '{"subtasks":[1],"extra":true}', '{"subtasks":[1.5]}']) {
      expect(() => parseClassifierOutput(output, [1, 2, 3])).toThrow(ClassifierProtocolError)
    }
    expect(() => parseClassifierOutput('{"subtasks":[9]}', [1, 2, 3])).toThrow('未知 Subtask')
  })
})
