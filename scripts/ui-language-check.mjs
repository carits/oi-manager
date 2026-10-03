import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const sourceRoot = path.join(root, 'apps', 'web', 'src')
const serverPresentationFiles = [
  path.join(root, 'apps', 'server', 'src', 'modules', 'training-engine', 'training-engine.templates.ts'),
]
const failures = []

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const target = path.join(directory, entry.name)
    return entry.isDirectory() ? walk(target) : [target]
  })
}

const files = [...walk(sourceRoot), ...serverPresentationFiles].filter(file => {
  const relative = path.relative(root, file).replaceAll('\\', '/')
  return /\.(?:ts|tsx)$/.test(file) && !/\.(?:test|spec)\.(?:ts|tsx)$/.test(file) && !relative.includes('/__tests__/')
})

const visibleTerms = [
  /\brevision\b/i,
  /\bsnapshot\b/i,
  /\bStable\b/,
  /\bEvolving\b/,
  /graph\s*hash|graphHash/i,
  /fencingToken|栅栏/,
  /canonicalProblemId|stageProblemId/,
  /Candidate Pool|Candidate Selector|Wrong Corpus|Hidden Holdout|Corpus R\d*/i,
  /\bDQS\b|Critical Gate/i,
  /测试数据槽|数据槽|槽位/,
  /\bStage(?:Group|Plan|Problem)?\b/,
]

function record(relative, lineNumber, rule, line) {
  failures.push(`${relative}:${lineNumber}: ${rule}: ${line.trim().slice(0, 220)}`)
}

function containsForbiddenVisibleTerm(text) {
  return visibleTerms.some(expression => expression.test(text))
}

for (const file of files) {
  const source = fs.readFileSync(file, 'utf8')
  const relative = path.relative(root, file).replaceAll('\\', '/')
  const lines = source.split(/\r?\n/)

  const clientDirective = source.search(/^["']use client["'];?\s*$/m)
  if (clientDirective >= 0 && source.slice(0, clientDirective).trim()) {
    record(relative, 1, 'use client directive must be the first expression', lines[0] || relative)
  }

  for (const [index, line] of lines.entries()) {
    const lineNumber = index + 1

    if (/\.error\.message\b/.test(line)) {
      record(relative, lineNumber, 'business UI must read ApiError.userMessage', line)
    }
    if (/(?:\b(?:error|err|cause)\.message\b|\(\s*(?:error|err|cause)\s+as\s+Error\s*\)\.message|\b[A-Za-z_$][\w$]*Error\??\.message\b)/.test(line) && !/console\.(?:error|warn|debug)\s*\(/.test(line)) {
      record(relative, lineNumber, 'runtime error text must pass through publicErrorMessage', line)
    }
    if (/(?:toast\.(?:error|warning|success|info)|set[A-Z][A-Za-z]*Error)\s*\([^\n]*(?:result|response|res|retry)\.message\b/.test(line)) {
      record(relative, lineNumber, 'backend response message must not enter user feedback directly', line)
    }
    if (/(?:LABELS?|labels|labelMap|LabelMap|_LABEL_MAP)\s*\[[^\]]+\]\s*(?:\|\||\?\?)\s*[A-Za-z_$][\w$.[\]?]*/.test(line)
      || /\b[A-Za-z_$][\w$]*\s*\[\s*([A-Za-z_$][\w$?.]*)\s*\]\s*(?:\|\||\?\?)\s*\1\b/.test(line)) {
      record(relative, lineNumber, 'presentation mapper must not fall back to the raw value', line)
    }
    if (/>[^<{\n]*\{\s*[A-Za-z_$][\w$?.]*\.(?:status|type|kind|role|platform|language|result)\s*\}[^<{\n]*</.test(line)) {
      record(relative, lineNumber, 'raw domain enum rendered in JSX', line)
    }
    if (/>[^<{\n]*(?<!\$)\{\s*(?:[A-Za-z_$][\w$?.]*\.(?:canonicalProblemId|stageProblemId|participantId|userId|organizationId|candidateId)|[A-Za-z_$][\w$?.]*job\.id(?:\.slice\([^)]*\))?)\s*\}[^<{\n]*</i.test(line)) {
      record(relative, lineNumber, 'internal identifier rendered as user content', line)
    }
    if (/>[^<{\n]*\{\s*JSON\.stringify\s*\(/.test(line) || /<pre[^>]*>[^\n]*JSON\.stringify\s*\(/.test(line)) {
      record(relative, lineNumber, 'raw JSON rendered in JSX', line)
    }

    const jsxText = /(?:return|=>|[?:]|&&|\()\s*</.test(line) || line.trimStart().startsWith('<')
      ? [...line.matchAll(/<[A-Za-z][^>]*>([^<{]+)</g)].map(match => match[1]).join(' ')
      : ''
    const visibleProp = [...line.matchAll(/(?:title|description|label|placeholder|hint|emptyText|submitText|aria-label)\s*=\s*(?:["']([^"']*)["']|\{[`"']([^`"']*)[`"']\})/g)]
      .flatMap(match => [match[1], match[2]]).filter(Boolean).join(' ')
    const feedbackCopy = [...line.matchAll(/(?:toast\.(?:error|warning|success|info)|setError|setMessage)\s*\(\s*[`"']([^`"']+)[`"']/g)].map(match => match[1]).join(' ')
    const serverObjectCopy = relative.startsWith('apps/server/')
      ? [...line.matchAll(/(?:name|title|description|label|hint|message)\s*:\s*[`"']([^`"']+)[`"']/g)].map(match => match[1]).join(' ')
      : ''
    const presentationCopy = [jsxText, visibleProp, feedbackCopy, serverObjectCopy].join(' ')
    if (presentationCopy && containsForbiddenVisibleTerm(presentationCopy)) {
      record(relative, lineNumber, 'internal implementation term appears in user-facing copy', line)
    }
  }
}

if (failures.length) {
  console.error(`UI language boundary failed with ${failures.length} issue(s):`)
  failures.forEach(failure => console.error(`- ${failure}`))
  process.exit(1)
}

console.log(`UI language boundary passed across ${files.length} source files.`)
