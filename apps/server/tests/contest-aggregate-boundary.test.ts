import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

function sourceFiles(root: string): string[] {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap(entry => {
    const target = path.join(root, entry.name)
    if (entry.isDirectory()) return sourceFiles(target)
    return entry.isFile() && target.endsWith('.ts') ? [target] : []
  })
}

describe('Contest aggregate write boundary', () => {
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
