import { describe, expect, it } from 'vitest'
import { validateAndCompileSpec, ValidatorSpecError } from '../src/modules/problem/problem.validator-spec.service'
import { compileJudgeProgram } from '../src/modules/problem/problem.judge-program.service'

describe('Validator DSL compiler', () => {
  it('compiles bounded arrays, EOF and declarative assertions', async () => {
    const result = validateAndCompileSpec({ version: 1, input: [
      { type: 'int', name: 'n', min: 1, max: 100000 },
      { type: 'array', name: 'a', length: 'n', element: { type: 'int', min: 1, max: 1000000000 } },
    ], assertions: [{ builtin: 'array.distinct', args: ['a'] }], strictEof: true })
    expect(result.source).toContain('inf.readLong(1LL,100000LL,"n")')
    expect(result.source).toContain('must be distinct')
    expect(result.source).toContain('inf.readEof()')
    expect(result.specHash).toMatch(/^[a-f0-9]{64}$/)
    await expect(compileJudgeProgram(result.source, 'cpp17', 'Validator DSL test')).resolves.toBeUndefined()
  })

  it('rejects unknown builtins, duplicate names and forward length references', () => {
    for (const spec of [
      { version: 1, input: [{ type: 'int', name: 'n' }, { type: 'int', name: 'n' }] },
      { version: 1, input: [{ type: 'array', name: 'a', length: 'n', element: { type: 'int' } }] },
      { version: 1, input: [{ type: 'int', name: 'n' }], assertions: [{ builtin: 'system.exec', args: ['n'] }] },
    ]) expect(() => validateAndCompileSpec(spec)).toThrow(ValidatorSpecError)
  })

  it('supports trusted graph predicates without embedding arbitrary code', () => {
    const result = validateAndCompileSpec({ version: 1, input: [
      { type: 'int', name: 'n', min: 1, max: 1000 },
      { type: 'int', name: 'm', min: 0, max: 2000 },
      { type: 'edgeList', name: 'edges', count: 'm', vertices: 'n', directed: false },
    ], assertions: [{ builtin: 'graph.isConnected', args: ['edges'] }], strictEof: true })
    expect(result.source).toContain('graph must be connected')
    expect(result.source).not.toContain('system(')
  })
})
