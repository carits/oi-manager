import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
const require = createRequire(new URL('../apps/web/package.json', import.meta.url))
const ts = require('typescript')
const write = process.argv.includes('--write')

// A narrow, readable, idempotent UI-only migration. No transport, authentication,
// authorization, domain commands, database, or baseline files are writable here.
const targets = [
  ['TrainingDesignAuxiliary.tsx', { button: 3, input: 2 }],
  ['TrainingSessionDesigner.tsx', { button: 2, input: 0 }],
  ['TrainingSessionWorkspace.tsx', { button: 1, input: 2 }],
]
function transform(source, filename) {
  const tree = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  assert.equal(tree.parseDiagnostics.length, 0, `${filename}: invalid input syntax`)
  const edits = []
  const counts = { button: 0, input: 0 }
  const names = new Set()
  function visit(node) {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxClosingElement(node)) {
      const tag = node.tagName
      if (ts.isIdentifier(tag) && (tag.text === 'button' || tag.text === 'input')) {
        const name = tag.text === 'button' ? 'Button' : 'Input'
        names.add(name)
        edits.push({ start: tag.getStart(tree), end: tag.end, text: name })
        if (!ts.isJsxClosingElement(node)) {
          counts[tag.text] += 1
          if (tag.text === 'button') edits.push({ start: tag.end, end: tag.end, text: ' variant="ghost"' })
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(tree)
  let result = source
  for (const edit of edits.sort((a, b) => b.start - a.start || b.end - a.end)) result = result.slice(0, edit.start) + edit.text + result.slice(edit.end)
  const imports = []
  for (const name of names) {
    const module = name === 'Button' ? '@/components/ui/Button' : '@/components/ui/FormControls'
    const declaration = tree.statements.find(node => ts.isImportDeclaration(node) && node.moduleSpecifier.text === module)
    const bindings = declaration?.importClause?.namedBindings
    const imported = bindings && ts.isNamedImports(bindings) && bindings.elements.some(element => element.name.text === name)
    if (!imported) imports.push(`import { ${name} } from '${module}'`)
  }
  if (imports.length) {
    const directive = result.match(/^(['"])use client\1;?\r?\n/)
    assert.ok(directive, `${filename}: expected client directive`)
    result = result.slice(0, directive[0].length) + '\n' + imports.join('\n') + '\n' + result.slice(directive[0].length)
  }
  assert.equal(ts.createSourceFile(filename, result, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX).parseDiagnostics.length, 0, `${filename}: invalid generated syntax`)
  return { source: result, counts }
}

// Verify we never replace tag-shaped text inside strings or lose handlers/props.
const sample = transform("'use client'\nconst example = '<button>'; export const view = <button disabled onClick={run}><input type=\"checkbox\" checked={ok} onChange={change} /></button>\n", 'sample.tsx')
assert.ok(sample.source.includes("const example = '<button>'"))
assert.ok(sample.source.includes('<Button variant="ghost" disabled onClick={run}>'))
assert.ok(sample.source.includes('<Input type="checkbox" checked={ok} onChange={change} />'))
assert.deepEqual(sample.counts, { button: 1, input: 1 })

for (const [name, expected] of targets) {
  const filename = path.join('apps/web/src/features/training-session/ui', name)
  const original = fs.readFileSync(filename, 'utf8')
  const migrated = transform(original, filename)
  if (migrated.counts.button === 0 && migrated.counts.input === 0) { console.log(`${filename}: already migrated`); continue }
  assert.deepEqual(migrated.counts, expected, `${filename}: source changed; review before migrating`)
  if (write) fs.writeFileSync(filename, migrated.source)
  console.log(`${filename}: ${JSON.stringify(migrated.counts)}${write ? ' migrated' : ' (dry run)'}`)
}
const cssFile = 'apps/web/src/features/training-session/ui/TrainingEngine.module.css'
let css = fs.readFileSync(cssFile, 'utf8')
for (const [from, to] of [
  ['rgb(15 23 42 / .42)', 'var(--overlay-backdrop)'],
  ['-12px 0 36px rgb(15 23 42 / .18)', 'var(--shadow-lg)'],
]) {
  const count = css.split(from).length - 1
  assert.ok(count === 0 || count === 2, `${cssFile}: unexpected token count ${count}`)
  css = css.replaceAll(from, to)
}
if (write) fs.writeFileSync(cssFile, css)
console.log(`Training UI primitive migration ${write ? 'written' : 'previewed'}; permission and API code unchanged.`)
