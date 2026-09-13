import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const sourceRoot = path.join(root, 'apps/web/src')
const baselinePath = path.join(root, 'scripts/ui-legacy-baseline.json')

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const target = path.join(directory, entry.name)
    return entry.isDirectory() ? walk(target) : [target]
  })
}
const relative = file => path.relative(root, file).replaceAll('\\', '/')
const sources = walk(sourceRoot).filter(file => /\.(tsx|css)$/.test(file))
const exemptUi = file => relative(file).includes('/components/ui/')
const count = (source, expression) => [...source.matchAll(expression)].length

const rules = {
  staticInlineStyle: { files: sources.filter(file => file.endsWith('.tsx') && !exemptUi(file)), expression: /\bstyle=\{\{/g },
  // Object-literal styles were already gated, but references such as
  // `style={formStyles.field}` or `style={cardStyle}` could silently bypass
  // the contract. Dynamic layout values are intentionally named separately
  // and remain allowed; static business-level style objects are legacy debt.
  staticInlineStyleReference: {
    files: sources.filter(file => file.endsWith('.tsx') && !exemptUi(file)),
    expression: /\bstyle=\{(?!(?:avatarStyle|chartStyle|matrixStyle|tableStyle|floatingPosition)\})(?:[A-Za-z_$][\w$]*Styles?\.[\w$]+|[A-Za-z_$][\w$]*(?:Style|Styles))\}/g,
  },
  nativeButton: { files: sources.filter(file => file.endsWith('.tsx') && !exemptUi(file)), expression: /<button\b/g },
  nativeInput: { files: sources.filter(file => file.endsWith('.tsx') && !exemptUi(file)), expression: /<(?:input|textarea|select)\b/g },
  nativeTable: { files: sources.filter(file => file.endsWith('.tsx') && !exemptUi(file)), expression: /<table\b/g },
  customDialog: { files: sources.filter(file => file.endsWith('.tsx') && !exemptUi(file)), expression: /role=["']dialog["']/g },
  directModal: { files: sources.filter(file => file.endsWith('.tsx') && !exemptUi(file)), expression: /(?:from\s+["']@\/components\/ui\/Modal["']|<Modal\b)/g },
  arbitraryModalWidth: { files: sources.filter(file => file.endsWith('.tsx') && !exemptUi(file)), expression: /<Modal\b[^>]*\bwidth=/gs },
  hardcodedVisual: { files: sources.filter(file => !relative(file).endsWith('/styles/globals.css') && !relative(file).endsWith('/components/ui/primitives.module.css')), expression: /#[0-9a-fA-F]{3,8}\b|rgba?\(/g },
}

function snapshot() {
  return Object.fromEntries(Object.entries(rules).map(([name, rule]) => [name,
    Object.fromEntries(rule.files.map(file => [relative(file), count(fs.readFileSync(file, 'utf8'), rule.expression)]).filter(([, violations]) => violations > 0).sort(([a], [b]) => a.localeCompare(b)))
  ]))
}

if (process.argv.includes('--update')) {
  fs.writeFileSync(baselinePath, `${JSON.stringify(snapshot(), null, 2)}\n`)
  console.log(`UI legacy baseline updated: ${relative(baselinePath)}`)
  process.exit(0)
}

if (!fs.existsSync(baselinePath)) throw new Error(`Missing ${relative(baselinePath)}; run with --update once`)
const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'))
const current = snapshot()
const failures = []
for (const [rule, files] of Object.entries(current)) {
  for (const [file, violations] of Object.entries(files)) {
    const allowed = baseline[rule]?.[file] || 0
    if (violations > allowed) failures.push(`${rule}: ${file} has ${violations}, baseline allows ${allowed}`)
  }
}
if (failures.length) {
  console.error(`UI component contract failed with ${failures.length} regression(s):`)
  failures.forEach(failure => console.error(`- ${failure}`))
  process.exit(1)
}
const totals = Object.fromEntries(Object.entries(current).map(([rule, files]) => [rule, Object.values(files).reduce((sum, value) => sum + value, 0)]))
console.log(`UI component contract passed: ${JSON.stringify(totals)}`)
