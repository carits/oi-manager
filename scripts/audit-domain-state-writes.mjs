import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const sourceRoot = path.join(root, 'apps', 'server', 'src')
const allowedHackWriter = 'apps/server/src/modules/problem/problem.hack-state.ts'
const allowedTrainingWriters = new Set()

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const target = path.join(directory, entry.name)
    return entry.isDirectory() ? walk(target) : [target]
  })
}

const violations = []
for (const file of walk(sourceRoot).filter(item => item.endsWith('.ts'))) {
  const relative = path.relative(root, file).replaceAll('\\', '/')
  if (relative === allowedHackWriter) continue
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/)
  lines.forEach((line, index) => {
    if (/\.problemHackAttempt\.(?:update|updateMany)\s*\(/.test(line)) {
      violations.push(`${relative}:${index + 1}: HackAttempt state writes must use problem.hack-state`)
    }
    if (!allowedTrainingWriters.has(relative)
      && /\.(?:training)\.(?:create|update|upsert|delete|createMany|updateMany|deleteMany)\s*\(/.test(line)) {
      violations.push(`${relative}:${index + 1}: Training aggregate writes must use training CRUD`)
    }
  })
}

console.log(JSON.stringify({ domainStateDirectWrites: violations.length, violations }, null, 2))
if (violations.length) process.exitCode = 1
