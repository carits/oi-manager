import { describe, expect, it } from 'vitest'
import yaml from 'js-yaml'
import {
  appendHackCase,
  isHackableJudgeConfig,
  resolveJudgeMode,
} from '../src/modules/problem/problem.hack.service'

describe('problem ACM Hack configuration', () => {
  it('only enables batch ACM configurations', () => {
    expect(isHackableJudgeConfig({ mode: 'acm', type: 'default' })).toBe(true)
    expect(isHackableJudgeConfig({ mode: 'acm', type: 'standard' })).toBe(true)
    expect(isHackableJudgeConfig({ mode: 'oi', type: 'default' })).toBe(false)
    expect(isHackableJudgeConfig({ mode: 'acm', type: 'interactive' })).toBe(false)
    expect(resolveJudgeMode({ subtasks: [{ cases: [] }] })).toBe('oi')
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
})
