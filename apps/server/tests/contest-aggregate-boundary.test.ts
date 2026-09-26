import fs from 'node:fs'
import path from 'node:path'
import { ContestContracts } from '@oi-manager/contracts'
import { describe, expect, it } from 'vitest'

function sourceFiles(root: string): string[] {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap(entry => {
    const target = path.join(root, entry.name)
    if (entry.isDirectory()) return sourceFiles(target)
    return entry.isFile() && target.endsWith('.ts') ? [target] : []
  })
}

describe('Contest aggregate write boundary', () => {
  it('validates submission pagination and discriminated rejudge requests', () => {
    expect(ContestContracts.submissions.query.parse({ page: '2', pageSize: '50' })).toMatchObject({ page: 2, pageSize: 50 })
    expect(ContestContracts.rejudge.body.safeParse({ scope: { type: 'problem', contestProblemId: 'cp-1' } }).success).toBe(true)
    expect(ContestContracts.rejudge.body.safeParse({ scope: { type: 'user_problem', contestProblemId: 'cp-1' } }).success).toBe(false)
    expect(ContestContracts.submissions.query.safeParse({ page: 1, pageSize: 201 }).success).toBe(false)
    expect(ContestContracts.updateContentSelection.body.safeParse({ statementOptionKey: 'canonical:s1', solutionOptionKey: 'none' }).success).toBe(true)
    expect(ContestContracts.saveStatementManagement.body.safeParse({ selections: [] }).success).toBe(true)
    expect(ContestContracts.testSetUpdate.body.safeParse({ revisionId: 'revision-1' }).success).toBe(true)
  })

  it('keeps runtime contest projection writes inside contest or maintenance modules', () => {
    const root = path.resolve(__dirname, '../src/modules')
    const violations = sourceFiles(root)
      .filter(file => !file.includes(`${path.sep}contest${path.sep}`) && !file.includes(`${path.sep}maintenance${path.sep}`))
      .flatMap(file => {
        const source = fs.readFileSync(file, 'utf8')
        return /(?:prisma|tx)\.contest(?:Problem)?\.(?:create|update|upsert|delete|createMany|updateMany|deleteMany)\s*\(/.test(source)
          ? [path.relative(root, file)]
          : []
      })
    expect(violations).toEqual([])
  })
})
