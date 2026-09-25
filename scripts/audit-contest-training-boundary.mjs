import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const failures = []
const walk = dir => fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
  const full = path.join(dir, entry.name)
  if (entry.isDirectory()) return ['node_modules','dist','.next','.next-e2e'].includes(entry.name) ? [] : walk(full)
  return /\.(ts|tsx|js|mjs)$/.test(entry.name) ? [full] : []
}) : []
const inspect = (dirs, pattern, message) => {
  for (const file of dirs.flatMap(walk)) {
    const text = fs.readFileSync(file, 'utf8')
    if (pattern.test(text)) failures.push(`${path.relative(root, file)}: ${message}`)
  }
}
inspect(['apps/server/src','apps/web/src','packages'], /\/api\/trainings(?:\/|['"`])|['"`]\/trainings\//, 'legacy /trainings API boundary is forbidden')
inspect(['apps/web/src/features/contest'], /\/api\/training-sessions/, 'Contest must not call Training Engine V2')
inspect(['apps/web/src/features/training-session'], /\/api\/contests/, 'Training Engine V2 must not call Contest')
inspect(['apps/server/src/modules/training-engine'], /(?:from|require\()\s*['"][^'"]*modules\/training|from\s+['"]\.\.\/training\//, 'Training Engine V2 must not import the Contest implementation module')
if (failures.length) { console.error(failures.join('\n')); process.exit(1) }
console.log('Contest / Training Engine V2 boundary audit passed')
