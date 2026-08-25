import { describe, expect, it } from 'vitest'
import yaml from 'js-yaml'
import {
  appendHackCase,
  allowedProblemLanguages,
  isHackableJudgeConfig,
  resolveJudgeMode,
  serializeHackAttempt,
} from '../src/modules/problem/problem.hack.service'

describe('problem ACM Hack configuration', () => {
  it('only enables supported batch ACM and OI configurations', () => {
    expect(isHackableJudgeConfig({ mode: 'acm', type: 'default' })).toBe(true)
    expect(isHackableJudgeConfig({ mode: 'acm', type: 'standard' })).toBe(true)
    expect(isHackableJudgeConfig({ mode: 'acm', type: 'objective' })).toBe(false)
    expect(isHackableJudgeConfig({ mode: 'oi', type: 'default' })).toBe(true)
    expect(isHackableJudgeConfig({ mode: 'acm', type: 'interactive' })).toBe(false)
    expect(resolveJudgeMode({ subtasks: [{ cases: [] }] })).toBe('oi')
  })

  it('only exposes languages actually registered by the local Judge', () => {
    expect(allowedProblemLanguages({
      allowedLanguages: JSON.stringify([{ id: 'cpp17' }, { id: 'java' }, { id: 'python3' }]),
      judgeConfig: null,
    })).toEqual(['cpp17', 'python3'])
  })

  it('keeps accepted Hack cases before ordinary cases and appends new Hack cases', () => {
    const source = yaml.dump({
      mode: 'acm',
      cases: [
        { input: 'hack_aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.in', output: 'hack_aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.out' },
        { input: '1.in', output: '1.out' },
      ],
    })
    const result = yaml.load(appendHackCase(source, 'problem', {
      input: 'hack_bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb.in',
      output: 'hack_bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb.out',
    })) as any
    expect(result.cases.map((item: any) => item.input)).toEqual([
      'hack_aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.in',
      'hack_bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb.in',
      '1.in',
    ])
    expect(result.mode).toBe('acm')
    expect(result.subtasks).toBeUndefined()
  })

  it('keeps source and generated data out of list responses', () => {
    const attempt = {
      id: 'hack-1',
      problemId: 'problem-1',
      userId: 'user-1',
      status: 'system_error',
      failureStage: 'standard',
      inputData: 'private input',
      generatorSource: 'private generator',
      hackSource: 'private target',
    }
    expect(serializeHackAttempt(attempt, false)).toMatchObject({ id: 'hack-1', failureStage: 'standard' })
    expect(serializeHackAttempt(attempt, false)).not.toHaveProperty('inputData')
    expect(serializeHackAttempt(attempt, false)).not.toHaveProperty('generatorSource')
    expect(serializeHackAttempt(attempt, false)).not.toHaveProperty('hackSource')
    expect(serializeHackAttempt(attempt, true)).toMatchObject({
      inputData: 'private input',
      generatorSource: 'private generator',
      hackSource: 'private target',
    })
  })
})
