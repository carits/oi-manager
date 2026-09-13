import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const fullPath = path.join(directory, entry.name)
    return entry.isDirectory() ? walk(fullPath) : [fullPath]
  })
}

function normalizePath(value) {
  const normalized = value.replaceAll('\\', '/').replace(/\/+$/, '')
  return normalized || '/'
}

function loadRouterPrefixes() {
  const docsCheck = fs.readFileSync(path.join(root, 'scripts/docs-check.mjs'), 'utf8')
  const block = docsCheck.match(/const routerPrefixes = (\{[\s\S]*?\r?\n\})\r?\n\r?\nconst endpointPattern/)
  if (!block) throw new Error('Unable to read routerPrefixes from scripts/docs-check.mjs')
  return Function(`"use strict"; return (${block[1]})`)()
}

function findCallEnd(source, start) {
  const open = source.indexOf('(', start)
  if (open < 0) return source.length
  let depth = 0
  let quote = null
  let escaped = false
  let lineComment = false
  let blockComment = false
  for (let index = open; index < source.length; index += 1) {
    const char = source[index]
    const next = source[index + 1]
    if (lineComment) {
      if (char === '\n') lineComment = false
      continue
    }
    if (blockComment) {
      if (char === '*' && next === '/') {
        blockComment = false
        index += 1
      }
      continue
    }
    if (quote) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === quote) quote = null
      continue
    }
    if (char === '/' && next === '/') {
      lineComment = true
      index += 1
      continue
    }
    if (char === '/' && next === '*') {
      blockComment = true
      index += 1
      continue
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char
      continue
    }
    if (char === '(') depth += 1
    else if (char === ')') {
      depth -= 1
      if (depth === 0) return index + 1
    }
  }
  return source.length
}

const routerPrefixes = loadRouterPrefixes()
const serverRoot = path.join(root, 'apps/server/src')
const routeFiles = walk(serverRoot).filter(file => {
  const relative = path.relative(root, file).replaceAll(path.sep, '/')
  return file.endsWith('.ts') &&
    (relative === 'apps/server/src/index.ts' || relative.includes('/routes/') || relative.endsWith('.routes.ts'))
})
// Authentication may be applied at the application composition root rather
// than inside an individual router. Read the same root used by production and
// integration tests so moving bootstrap code cannot silently weaken the audit.
const applicationSource = fs.readFileSync(path.join(serverRoot, 'app.ts'), 'utf8')
const protectedMounts = new Set(
  [...applicationSource.matchAll(/app\.use\(\s*(['"])[^'"]+\1\s*,\s*authenticate\s*,\s*([A-Za-z][A-Za-z0-9_]*)/g)]
    .map(match => match[2]),
)

const routePattern = /\b([A-Za-z][A-Za-z0-9_]*)\.(get|post|put|patch|delete)\(\s*(["'])(\/[^"']*)\3/gms
const endpoints = []
const unknownRouters = new Set()

for (const file of routeFiles) {
  const source = fs.readFileSync(file, 'utf8')
  const authenticatedAliases = new Set(
    [...source.matchAll(/\bconst\s+([A-Za-z][A-Za-z0-9_]*)\s*=\s*\[[^\]]*\bauthenticate\b[^\]]*\]/gms)]
      .map(match => match[1]),
  )
  const scopedAuth = new Map()
  for (const match of source.matchAll(/\b([A-Za-z][A-Za-z0-9_]*)\.use\(\s*(?:(["'])(\/[^"']*)\2\s*,\s*)?authenticate\b/g)) {
    const prefixes = scopedAuth.get(match[1]) || []
    prefixes.push(match[3] || '/')
    scopedAuth.set(match[1], prefixes)
  }

  for (const match of source.matchAll(routePattern)) {
    const router = match[1]
    if (!(router in routerPrefixes)) {
      unknownRouters.add(`${router} (${path.relative(root, file).replaceAll(path.sep, '/')})`)
      continue
    }
    const method = match[2].toUpperCase()
    const routePath = match[4]
    const endpoint = `${method} ${normalizePath(routerPrefixes[router] + routePath)}`
    const call = source.slice(match.index, findCallEnd(source, match.index))
    const explicitAuth = /\bauthenticate\b/.test(call) ||
      [...authenticatedAliases].some(alias => new RegExp(`\\b${alias}\\b`).test(call))
    const mountedAuth = protectedMounts.has(router)
    const scopedPrefixes = scopedAuth.get(router) || []
    const scoped = scopedPrefixes.some(prefix => prefix === '/' || routePath === prefix || routePath.startsWith(`${prefix}/`))
    endpoints.push({
      endpoint,
      method,
      path: normalizePath(routerPrefixes[router] + routePath),
      router,
      file: path.relative(root, file).replaceAll(path.sep, '/'),
      line: source.slice(0, match.index).split('\n').length,
      authenticated: explicitAuth || mountedAuth || scoped,
    })
  }
}

if (unknownRouters.size) {
  console.error(`Unknown routers:\n${[...unknownRouters].sort().join('\n')}`)
  process.exitCode = 1
}

const unique = new Map()
for (const item of endpoints) {
  const previous = unique.get(item.endpoint)
  if (!previous || (!previous.authenticated && item.authenticated)) unique.set(item.endpoint, item)
}

const publicPolicyPath = path.join(root, 'scripts/api-public-endpoints.json')
const publicPolicy = fs.existsSync(publicPolicyPath)
  ? JSON.parse(fs.readFileSync(publicPolicyPath, 'utf8'))
  : []
const allowedPublic = new Map(publicPolicy.map(item => [`${item.method} ${normalizePath(item.path)}`, item]))
const publicEndpoints = [...unique.values()].filter(item => !item.authenticated).sort((a, b) => a.endpoint.localeCompare(b.endpoint))
const undocumentedPublic = publicEndpoints.filter(item => !allowedPublic.has(item.endpoint))
const stalePolicy = [...allowedPublic.keys()].filter(endpoint => !publicEndpoints.some(item => item.endpoint === endpoint))

console.log(`API authentication audit: ${unique.size} endpoints, ${unique.size - publicEndpoints.length} authenticated, ${publicEndpoints.length} explicitly public`)
for (const item of publicEndpoints) {
  const policy = allowedPublic.get(item.endpoint)
  console.log(`${policy ? 'PUBLIC' : 'UNDECLARED'} ${item.endpoint} (${item.file}:${item.line})${policy ? ` — ${policy.rationale}` : ''}`)
}

if (undocumentedPublic.length) {
  console.error(`\nPublic endpoints missing an explicit policy (${undocumentedPublic.length}):`)
  for (const item of undocumentedPublic) console.error(`- ${item.endpoint} (${item.file}:${item.line})`)
  process.exitCode = 1
}
if (stalePolicy.length) {
  console.error(`\nStale public endpoint policy entries (${stalePolicy.length}):`)
  for (const endpoint of stalePolicy) console.error(`- ${endpoint}`)
  process.exitCode = 1
}
