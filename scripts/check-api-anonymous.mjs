import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const baseUrl = (process.env.API_AUDIT_BASE_URL || 'http://127.0.0.1:3002').replace(/\/+$/, '')
const apiDocument = fs.readFileSync(path.join(root, 'docs/reference/api/README.md'), 'utf8')
const policy = JSON.parse(fs.readFileSync(path.join(root, 'scripts/api-public-endpoints.json'), 'utf8'))
const publicEndpoints = new Set(policy.map(item => `${item.method} ${item.path}`))
const endpointPattern = /^\|\s*`(GET|POST|PUT|PATCH|DELETE)`\s*\|\s*`(\/api[^`]*)`\s*\|/gm
const endpoints = [...apiDocument.matchAll(endpointPattern)].map(match => ({ method: match[1], path: match[2] }))

function concretePath(routePath) {
  return routePath
    .replace(/:([A-Za-z][A-Za-z0-9_]*)/g, 'audit-missing-$1')
    .replace(/\*/g, 'audit-missing-wildcard')
}

async function probe(endpoint) {
  const key = `${endpoint.method} ${endpoint.path}`
  const isPublic = publicEndpoints.has(key)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10_000)
  try {
    const response = await fetch(`${baseUrl}${concretePath(endpoint.path)}`, {
      method: endpoint.method,
      redirect: 'manual',
      signal: controller.signal,
      headers: endpoint.method === 'GET' || endpoint.method === 'DELETE'
        ? undefined
        : { 'content-type': 'application/json' },
      body: endpoint.method === 'GET' || endpoint.method === 'DELETE' ? undefined : '{}',
    })
    const passed = isPublic
      ? ![401, 403].includes(response.status) && response.status < 500
      : response.status === 401
    return { ...endpoint, key, isPublic, status: response.status, passed }
  } catch (error) {
    return { ...endpoint, key, isPublic, status: 'ERROR', passed: false, error: error instanceof Error ? error.message : String(error) }
  } finally {
    clearTimeout(timeout)
  }
}

const results = []
const concurrency = 12
for (let index = 0; index < endpoints.length; index += concurrency) {
  results.push(...await Promise.all(endpoints.slice(index, index + concurrency).map(probe)))
}

const failures = results.filter(item => !item.passed)
const protectedCount = results.filter(item => !item.isPublic).length
console.log(`Anonymous API audit: ${results.length} endpoints, ${protectedCount} protected, ${results.length - protectedCount} public, ${failures.length} failures`)
for (const item of results.filter(item => item.isPublic)) console.log(`PUBLIC ${item.status} ${item.key}`)
if (failures.length) {
  console.error('\nAnonymous authentication failures:')
  for (const item of failures) {
    console.error(`- expected ${item.isPublic ? 'a non-auth, non-5xx response' : '401'}, received ${item.status}: ${item.key}${item.error ? ` (${item.error})` : ''}`)
  }
  process.exitCode = 1
}
