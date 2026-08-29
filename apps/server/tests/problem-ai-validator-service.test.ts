import { describe, expect, it } from 'vitest'
import { extractValidatorPayload } from '../src/modules/problem/application/problem-ai-validator.service'

describe('extractValidatorPayload', () => {
  it('accepts the structured Validator contract and strips code fences', () => {
    const result = extractValidatorPayload(JSON.stringify({
      validatorSource: '```cpp\n#include "testlib.h"\nint main(){}\n```',
      constraints: ['1 <= n <= 100'],
      eofRules: ['strict EOF'],
      assumptions: [],
    }))
    expect(result.validatorSource).toContain('#include "testlib.h"')
    expect(result.validatorSource).not.toContain('```')
    expect(result.constraints).toEqual(['1 <= n <= 100'])
  })

  it('fails closed when source is absent', () => {
    expect(() => extractValidatorPayload('{"constraints":[]}')).toThrow('validatorSource')
  })
})
