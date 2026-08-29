import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const serverEnvPath = path.resolve(process.env.RUNTIME_SERVER_ENV || path.join(root, 'apps/server/.env'))
const judgeEnvPath = path.resolve(process.env.RUNTIME_JUDGE_ENV || path.join(root, 'apps/judge/.env'))

function parseEnv(file) {
  const values = {}
  for (const rawLine of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
    if (!match) continue
    let value = match[2].trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    values[match[1]] = value
  }
  return values
}

function inspectFile(file) {
  const resolved = fs.realpathSync(file)
  const stat = fs.statSync(resolved)
  const mode = stat.mode & 0o777
  return {
    path: path.relative(root, file) || '.',
    resolvedInsideRepository: resolved === root || resolved.startsWith(`${root}${path.sep}`),
    mode: mode.toString(8).padStart(3, '0'),
    ownerIsCurrentUser: typeof process.getuid !== 'function' || stat.uid === process.getuid(),
    safePermissions: (mode & 0o007) === 0 && (mode & 0o020) === 0,
  }
}

function field(values, name, minimumLength) {
  const value = values[name] || ''
  return { present: Boolean(value), length: value.length, meetsMinimum: value.length >= minimumLength }
}

const server = parseEnv(serverEnvPath)
const judge = parseEnv(judgeEnvPath)
const serverFile = inspectFile(serverEnvPath)
const judgeFile = inspectFile(judgeEnvPath)
const secrets = {
  JWT_SECRET: field(server, 'JWT_SECRET', 32),
  JUDGE_TOKEN: field(server, 'JUDGE_TOKEN', 32),
  ACCOUNT_ENCRYPT_KEY: {
    ...field(server, 'ACCOUNT_ENCRYPT_KEY', 64),
    validHexKey: /^[0-9a-f]{64}$/i.test(server.ACCOUNT_ENCRYPT_KEY || ''),
  },
}
const secretValues = [server.JWT_SECRET, server.JUDGE_TOKEN, server.ACCOUNT_ENCRYPT_KEY].filter(Boolean)
const origins = (server.CORS_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean)
const csrfOrigins = (server.CSRF_TRUSTED_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean)
const csrfRequiresOrigin = server.CSRF_REQUIRE_ORIGIN === 'true' ||
  (!Object.hasOwn(server, 'CSRF_REQUIRE_ORIGIN') && server.APP_ENV === 'production')
const violations = []
const warnings = []

for (const [name, state] of Object.entries(secrets)) {
  const minimum = name === 'ACCOUNT_ENCRYPT_KEY' ? 64 : 32
  if (!state.present || !state.meetsMinimum) violations.push(`${name} must contain at least ${minimum} characters`)
}
if (!secrets.ACCOUNT_ENCRYPT_KEY.validHexKey) violations.push('ACCOUNT_ENCRYPT_KEY must contain exactly 64 hexadecimal characters')
if (new Set(secretValues).size !== secretValues.length) violations.push('Runtime secrets must be mutually distinct')
if (!judge.JUDGE_TOKEN || judge.JUDGE_TOKEN !== server.JUDGE_TOKEN) violations.push('Server and Judge JUDGE_TOKEN values must match')
if (!serverFile.safePermissions || !judgeFile.safePermissions) violations.push('Runtime env files must not be group-writable or world-accessible')
if (!serverFile.ownerIsCurrentUser || !judgeFile.ownerIsCurrentUser) violations.push('Runtime env files must be owned by the service user')
if (origins.some(origin => origin === '*' || origin.includes('*'))) violations.push('CORS_ORIGINS must not contain wildcards')
if (origins.length === 0) warnings.push('CORS_ORIGINS is empty; cross-origin requests remain blocked')
if (server.COOKIE_SECURE !== 'true') warnings.push('COOKIE_SECURE is not true; enable it together with HTTPS')
if (!csrfRequiresOrigin) warnings.push('CSRF strict Origin requirement is not enabled; enable it together with HTTPS')
if (server.COOKIE_SECURE === 'true' && !csrfRequiresOrigin) {
  violations.push('COOKIE_SECURE=true requires strict CSRF Origin validation')
}
if (csrfOrigins.some(origin => origin === '*' || origin.includes('*'))) {
  violations.push('CSRF_TRUSTED_ORIGINS must not contain wildcards')
}
if (server.COOKIE_SECURE === 'true' && csrfOrigins.some(origin => !origin.startsWith('https://'))) {
  violations.push('Secure-cookie CSRF trusted origins must use HTTPS')
}
if (!serverFile.resolvedInsideRepository) warnings.push('Server env still resolves outside the current deployment repository')

const report = {
  files: { server: serverFile, judge: judgeFile },
  secrets,
  secretsMutuallyDistinct: new Set(secretValues).size === secretValues.length,
  judgeTokenMatchesServer: Boolean(judge.JUDGE_TOKEN) && judge.JUDGE_TOKEN === server.JUDGE_TOKEN,
  cors: { configuredOriginCount: origins.length, containsWildcard: origins.some(origin => origin.includes('*')) },
  cookieSecure: server.COOKIE_SECURE === 'true',
  csrf: {
    requireOrigin: csrfRequiresOrigin,
    configuredOriginCount: csrfOrigins.length,
    containsWildcard: csrfOrigins.some(origin => origin.includes('*')),
  },
  violations,
  warnings,
}

console.log(JSON.stringify(report, null, 2))
if (violations.length) process.exitCode = 1
