#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = process.cwd()
const MODULES_PATH = resolve(ROOT, 'docs/ai-context/modules.json')
const GAPS_PATH = resolve(ROOT, 'docs/ai-context/GAPS.md')

function fail(message) {
  console.error('ai-context: ' + message)
  process.exit(1)
}

function git(args) {
  try {
    return execFileSync('git', args, {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 32 * 1024 * 1024,
    }).trim()
  } catch (error) {
    const stderr = error && error.stderr ? String(error.stderr).trim() : ''
    fail(stderr || ('git ' + args.join(' ') + ' failed'))
  }
}

function parseArgs(argv) {
  const out = {
    module: 'auto',
    base: '',
    head: 'HEAD',
    maxFiles: undefined,
    maxTests: undefined,
    maxDiffLines: undefined,
    write: '',
    noDiff: false,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const next = () => {
      const value = argv[index + 1]
      if (!value || value.startsWith('--')) fail(arg + ' requires a value')
      index += 1
      return value
    }
    if (arg === '--module') out.module = next()
    else if (arg === '--base') out.base = next()
    else if (arg === '--head') out.head = next()
    else if (arg === '--max-files') out.maxFiles = Number(next())
    else if (arg === '--max-tests') out.maxTests = Number(next())
    else if (arg === '--max-diff-lines') out.maxDiffLines = Number(next())
    else if (arg === '--write') out.write = next()
    else if (arg === '--no-diff') out.noDiff = true
    else if (arg === '--help' || arg === '-h') {
      console.log([
        'Usage:',
        '  pnpm ai:context -- --module <name|auto> [--base <ref>] [--head <ref>]',
        '                    [--max-files N] [--max-tests N] [--max-diff-lines N]',
        '                    [--no-diff] [--write <path>]',
        '',
        'Examples:',
        '  pnpm ai:context -- --module training-engine --base aebe16cb --head HEAD',
        '  pnpm ai:context -- --module auto --base origin/main --head HEAD',
        '  pnpm ai:context -- --module organization --no-diff',
      ].join('\n'))
      process.exit(0)
    } else fail('unknown argument: ' + arg)
  }
  return out
}

function escapeRegex(value) {
  return value.replace(/[|\\{}()[\]^$+?.]/g, '\\$&')
}

function globToRegex(glob) {
  let pattern = ''
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index]
    if (char === '*') {
      if (glob[index + 1] === '*') {
        pattern += '.*'
        index += 1
      } else {
        pattern += '[^/]*'
      }
    } else {
      pattern += escapeRegex(char)
    }
  }
  return new RegExp('^' + pattern + '$')
}

function matchesAny(path, globs) {
  return globs.some(glob => globToRegex(glob).test(path))
}

function refExists(ref) {
  try {
    execFileSync('git', ['rev-parse', '--verify', ref], { cwd: ROOT, stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

function resolveBase(input, mainRef) {
  if (input) {
    if (!refExists(input)) fail('base ref not found: ' + input)
    return input
  }
  const candidates = [...new Set([mainRef, 'origin/main', 'main'].filter(Boolean))]
  for (const candidate of candidates) {
    if (refExists(candidate)) return git(['merge-base', candidate, 'HEAD'])
  }
  fail('cannot resolve a base ref; pass --base <commit>')
}

function shortSha(ref) {
  return git(['rev-parse', '--short=12', ref])
}

function changedFiles(base, head) {
  const output = git(['diff', '--name-only', base + '..' + head])
  return output ? output.split('\n').filter(Boolean) : []
}

function commitLines(base, head) {
  const output = git(['log', '--format=%h %ad %s', '--date=short', base + '..' + head])
  return output ? output.split('\n').filter(Boolean) : []
}

function isTest(path) {
  return /(^|\/)(tests?|e2e)(\/|$)|\.(test|spec)\.[cm]?[jt]sx?$/.test(path)
}

function priority(path) {
  let value = 0
  if (/packages\/contracts\//.test(path)) value += 90
  if (/prisma\/schema\.prisma$/.test(path)) value += 85
  if (/prisma\/migrations\//.test(path)) value += 80
  if (/\/src\/modules\//.test(path)) value += 70
  if (/\/features\//.test(path)) value += 65
  if (/\.service\.[jt]s$/.test(path)) value += 20
  if (/\.routes\.[jt]s$/.test(path)) value += 15
  if (isTest(path)) value -= 20
  if (/docs\//.test(path)) value -= 30
  return value
}

function extractGapSection(markdown, moduleName) {
  const marker = '## ' + moduleName
  const start = markdown.indexOf(marker)
  if (start < 0) return ''
  const rest = markdown.slice(start + marker.length)
  const next = rest.search(/\n## [^#]/)
  return (next >= 0 ? rest.slice(0, next) : rest).trim()
}

function escalation(changed) {
  const reasons = []
  if (changed.some(path => path === 'apps/server/prisma/schema.prisma' || path.includes('/prisma/migrations/'))) {
    reasons.push('schema: Prisma Schema / migration changed; read DATA_MODEL and migration evidence.')
  }
  if (changed.some(path => path.startsWith('packages/contracts/'))) {
    reasons.push('contract: public/shared Runtime Contract changed; inspect server and browser callers.')
  }
  if (changed.some(path => /auth|authorization|membership|capabilit/i.test(path))) {
    reasons.push('auth: identity/authorization surface changed; inspect AUTHORIZATION invariants.')
  }
  if (changed.some(path => /judge|submission/i.test(path))) {
    reasons.push('judge: Judge/Submission surface changed; inspect canonical Judge/Submission docs when behavior depends on it.')
  }
  if (changed.some(path => /components\/ui|app\/.*layout|router|navigation/i.test(path))) {
    reasons.push('shared-ui-routing: common UI or routing surface changed; check blast radius before assuming module-local behavior.')
  }
  return reasons
}

function diffForFiles(base, head, files, maxLines) {
  if (!files.length || maxLines <= 0) return { text: '', truncated: false, lines: 0 }
  const output = git(['diff', '--unified=2', base + '..' + head, '--', ...files])
  const lines = output.split('\n')
  if (lines.length <= maxLines) return { text: output, truncated: false, lines: lines.length }
  return {
    text: lines.slice(0, maxLines).join('\n'),
    truncated: true,
    lines: lines.length,
  }
}

if (!existsSync(MODULES_PATH)) fail('docs/ai-context/modules.json not found')
if (!existsSync(GAPS_PATH)) fail('docs/ai-context/GAPS.md not found')

const args = parseArgs(process.argv.slice(2))
const config = JSON.parse(readFileSync(MODULES_PATH, 'utf8'))
const defaults = config.defaults || {}
const base = resolveBase(args.base, defaults.mainRef || 'origin/main')
const head = args.head || 'HEAD'
if (!refExists(head)) fail('head ref not found: ' + head)

const allChanged = changedFiles(base, head)
const moduleEntries = Object.entries(config.modules || {})
const detected = moduleEntries
  .filter(([, value]) => allChanged.some(path => matchesAny(path, value.paths || [])))
  .map(([name]) => name)

const requestedModules = args.module === 'auto'
  ? detected
  : args.module.split(',').map(item => item.trim()).filter(Boolean)

for (const name of requestedModules) {
  if (!config.modules[name]) fail('unknown module "' + name + '". Available: ' + Object.keys(config.modules).join(', '))
}

const effectiveModules = requestedModules
const modulePaths = effectiveModules.flatMap(name => config.modules[name].paths || [])
const relevantChanged = effectiveModules.length
  ? allChanged.filter(path => matchesAny(path, modulePaths))
  : allChanged

const maxFiles = Number.isFinite(args.maxFiles) ? args.maxFiles : (defaults.maxFiles || 8)
const maxTests = Number.isFinite(args.maxTests) ? args.maxTests : (defaults.maxTests || 3)
const maxDiffLines = Number.isFinite(args.maxDiffLines) ? args.maxDiffLines : (defaults.maxDiffLines || 1200)

const sourceCandidates = relevantChanged
  .filter(path => !isTest(path))
  .sort((a, b) => priority(b) - priority(a) || a.localeCompare(b))
const testCandidates = relevantChanged
  .filter(isTest)
  .sort((a, b) => priority(b) - priority(a) || a.localeCompare(b))

const selectedSource = sourceCandidates.slice(0, maxFiles)
const selectedTests = testCandidates.slice(0, maxTests)
const selected = [...selectedSource, ...selectedTests]
const stableSpecs = [...new Set(effectiveModules.flatMap(name => config.modules[name].stableSpecs || []))]
const gapMarkdown = readFileSync(GAPS_PATH, 'utf8')
const gapSections = effectiveModules
  .map(name => ({ name, text: extractGapSection(gapMarkdown, name) }))
  .filter(item => item.text)
const escalationReasons = escalation(relevantChanged)
const diff = args.noDiff ? { text: '', truncated: false, lines: 0 } : diffForFiles(base, head, selected, maxDiffLines)
const commits = commitLines(base, head)
const excludedRelevant = Math.max(0, relevantChanged.length - selected.length)
const unrelatedChanged = Math.max(0, allChanged.length - relevantChanged.length)

const lines = []
lines.push('# AI Context Pack')
lines.push('')
lines.push('- generated_at: ' + new Date().toISOString())
lines.push('- base: ' + shortSha(base) + ' (' + base + ')')
lines.push('- head: ' + shortSha(head) + ' (' + head + ')')
lines.push('- modules: ' + (effectiveModules.length ? effectiveModules.join(', ') : 'none detected'))
lines.push('- changed_files_total: ' + allChanged.length)
lines.push('- relevant_changed_files: ' + relevantChanged.length)
lines.push('- selected_source_files: ' + selectedSource.length + '/' + maxFiles)
lines.push('- selected_test_files: ' + selectedTests.length + '/' + maxTests)
lines.push('- excluded_relevant_files: ' + excludedRelevant)
lines.push('- unrelated_changed_files: ' + unrelatedChanged)
lines.push('')

lines.push('## Read first')
lines.push('')
lines.push('- AGENTS.md')
for (const spec of stableSpecs) lines.push('- ' + spec)
if (!stableSpecs.length) lines.push('- No module-specific stable spec matched. Do not compensate by reading the whole repository.')
lines.push('')

lines.push('## Verified open gaps')
lines.push('')
if (!gapSections.length) {
  lines.push('No module Gap section matched.')
} else {
  for (const section of gapSections) {
    lines.push('### ' + section.name)
    lines.push('')
    lines.push(section.text)
    lines.push('')
  }
}

lines.push('## Commits in range')
lines.push('')
if (commits.length) commits.forEach(line => lines.push('- ' + line))
else lines.push('- No commits in range.')
lines.push('')

lines.push('## Relevant changed files')
lines.push('')
if (relevantChanged.length) relevantChanged.forEach(path => lines.push('- ' + path))
else lines.push('- None.')
lines.push('')

lines.push('## First-read source files')
lines.push('')
if (selectedSource.length) selectedSource.forEach(path => lines.push('- ' + path))
else lines.push('- None.')
lines.push('')

lines.push('## First-read tests')
lines.push('')
if (selectedTests.length) selectedTests.forEach(path => lines.push('- ' + path))
else lines.push('- None.')
lines.push('')

lines.push('## Escalation triggers')
lines.push('')
if (escalationReasons.length) escalationReasons.forEach(reason => lines.push('- ' + reason))
else lines.push('- None. Stay inside the module unless the call chain proves otherwise.')
lines.push('')

lines.push('## Agent instructions for this turn')
lines.push('')
lines.push('1. Treat stable specs and current code as authoritative; chat history is secondary.')
lines.push('2. Start with the files listed above. Do not scan the whole repository by default.')
lines.push('3. Separate newly changed facts, previously verified open gaps, and unchanged facts.')
lines.push('4. Expand context only for a concrete dependency or escalation trigger, and state why.')
lines.push('5. If a verified gap is closed or a new durable gap is established, update docs/ai-context/GAPS.md.')
lines.push('6. For progress reviews, do not re-prove untouched functionality.')
lines.push('')

if (!args.noDiff) {
  lines.push('## Selected diff (budget ' + maxDiffLines + ' lines)')
  lines.push('')
  if (diff.text) {
    lines.push('~~~diff')
    lines.push(diff.text)
    lines.push('~~~')
    if (diff.truncated) {
      lines.push('')
      lines.push('Diff truncated: selected diff has ' + diff.lines + ' lines; budget is ' + maxDiffLines + '. Read individual selected files/hunks only as needed.')
    }
  } else {
    lines.push('No selected diff.')
  }
}

const output = lines.join('\n') + '\n'
if (args.write) {
  writeFileSync(resolve(ROOT, args.write), output)
  console.error('ai-context: wrote ' + args.write)
} else {
  process.stdout.write(output)
}
