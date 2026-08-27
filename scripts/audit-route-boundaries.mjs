import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const baselinePath = path.join(root, 'scripts', 'route-boundary-baseline.json')
const update = process.argv.includes('--update')

function walk(directory) {
  if (!fs.existsSync(directory)) return []
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const target = path.join(directory, entry.name)
    return entry.isDirectory() ? walk(target) : [target]
  })
}

const files = [
  ...walk(path.join(root, 'apps/server/src/routes')).filter(file => file.endsWith('.ts')),
  ...walk(path.join(root, 'apps/server/src/modules')).filter(file => file.endsWith('.routes.ts')),
]

const categories = {
  prisma: [/from\s+['"][^'"]*prisma['"]/, /\bprisma\./],
  transaction: [/\$transaction\b/, /TransactionClient/],
  filesystem: [/from\s+['"](?:node:)?fs['"]/, /\bfs\.(?:promises\.)?/, /from\s+['"](?:node:)?child_process['"]/],
  judgeRuntime: [/from\s+['"][^'"]*(?:ws\/judge|judge-manager)[^'"]*['"]/, /\bjudgeManager\b/],
}

const current = Object.fromEntries(files.sort().map(file => {
  const relative = path.relative(root, file).replaceAll('\\', '/')
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/)
  const counts = Object.fromEntries(Object.entries(categories).map(([name, patterns]) => [
    name,
    lines.filter(line => patterns.some(pattern => pattern.test(line))).length,
  ]))
  return [relative, counts]
}))

if (update) {
  fs.writeFileSync(baselinePath, `${JSON.stringify(current, null, 2)}\n`)
  console.log(`Route boundary baseline updated: ${Object.keys(current).length} adapters`)
  process.exit(0)
}

if (!fs.existsSync(baselinePath)) throw new Error('Missing route boundary baseline; run with --update once')
const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'))
const failures = []
for (const [file, counts] of Object.entries(current)) {
  const previous = baseline[file] || Object.fromEntries(Object.keys(categories).map(name => [name, 0]))
  for (const [category, count] of Object.entries(counts)) {
    if (count > Number(previous[category] || 0)) failures.push(`${file}: ${category} ${previous[category] || 0} -> ${count}`)
  }
}

const totals = Object.fromEntries(Object.keys(categories).map(category => [
  category,
  Object.values(current).reduce((sum, counts) => sum + counts[category], 0),
]))
console.log(JSON.stringify({ adapters: Object.keys(current).length, totals, failures }, null, 2))
if (failures.length) process.exitCode = 1
