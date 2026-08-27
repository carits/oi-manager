import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const LEGACY_ACCOUNT_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
const apply = process.argv.includes('--apply')
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const envPath = path.resolve(process.env.RUNTIME_SERVER_ENV || path.join(repositoryRoot, 'apps/server/.env'))
const backupRoot = path.resolve(process.env.RUNTIME_SECRET_BACKUP_DIR || '/data/backups/oi-manager/secrets')
const corsOrigins = process.env.RUNTIME_CORS_ORIGINS || 'http://47.99.222.76:3000'

function parseEnv(content: string) {
  const result: Record<string, string> = {}
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
    if (!match) continue
    let value = match[2].trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1)
    result[match[1]] = value
  }
  return result
}

function replaceEnv(content: string, updates: Record<string, string>) {
  const pending = new Map(Object.entries(updates))
  const lines = content.split(/\r?\n/).map(line => {
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=/)
    if (!match || !pending.has(match[1])) return line
    const value = pending.get(match[1])!
    pending.delete(match[1])
    return `${match[1]}=${value}`
  })
  while (lines.length && lines.at(-1) === '') lines.pop()
  for (const [key, value] of pending) lines.push(`${key}=${value}`)
  return `${lines.join('\n')}\n`
}

function keyBuffer(value: string, label: string) {
  if (!/^[0-9a-f]{64}$/i.test(value)) throw new Error(`${label} must contain exactly 64 hexadecimal characters`)
  return Buffer.from(value, 'hex')
}

function decrypt(password: string, ivHex: string, key: Buffer) {
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, Buffer.from(ivHex, 'hex'))
  return decipher.update(password, 'hex', 'utf8') + decipher.final('utf8')
}

function encrypt(password: string, key: Buffer) {
  const iv = crypto.randomBytes(16)
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv)
  return {
    password: cipher.update(password, 'utf8', 'hex') + cipher.final('hex'),
    passwordIV: iv.toString('hex'),
  }
}

async function main() {
  const resolvedEnv = fs.realpathSync(envPath)
  const originalContent = fs.readFileSync(resolvedEnv, 'utf8')
  const current = parseEnv(originalContent)
  const databaseUrl = process.env.RUNTIME_DATABASE_URL_OVERRIDE || current.DATABASE_URL
  if (!databaseUrl) throw new Error('DATABASE_URL is missing from the Server environment')
  process.env.DATABASE_URL = databaseUrl

  const oldAccountKeyText = current.ACCOUNT_ENCRYPT_KEY || LEGACY_ACCOUNT_KEY
  const oldAccountKey = keyBuffer(oldAccountKeyText, 'Current ACCOUNT_ENCRYPT_KEY')
  const newAccountKeyText = crypto.randomBytes(32).toString('hex')
  const newAccountKey = keyBuffer(newAccountKeyText, 'New ACCOUNT_ENCRYPT_KEY')
  const newJwtSecret = crypto.randomBytes(48).toString('base64url')
  const nextContent = replaceEnv(originalContent, {
    JWT_SECRET: newJwtSecret,
    ACCOUNT_ENCRYPT_KEY: newAccountKeyText,
    CORS_ORIGINS: corsOrigins,
  })

  const { PrismaClient } = await import('@prisma/client')
  const prisma = new PrismaClient()
  try {
    const accounts = await prisma.ojAccount.findMany({
      where: { password: { not: null }, passwordIV: { not: null } },
      select: { id: true, password: true, passwordIV: true },
    })
    const rotated = accounts.map(account => {
      const plaintext = decrypt(account.password!, account.passwordIV!, oldAccountKey)
      const next = encrypt(plaintext, newAccountKey)
      if (decrypt(next.password, next.passwordIV, newAccountKey) !== plaintext) {
        throw new Error(`OJ account ${account.id} failed pre-rotation verification`)
      }
      return {
        id: account.id,
        previousPassword: account.password!,
        previousIv: account.passwordIV!,
        ...next,
      }
    })

    if (!apply) {
      console.log(JSON.stringify({ mode: 'check', decryptableAccounts: rotated.length, envResolvesInsideRepository: resolvedEnv.startsWith(`${repositoryRoot}${path.sep}`), ready: true }, null, 2))
      return
    }

    fs.mkdirSync(backupRoot, { recursive: true, mode: 0o700 })
    fs.chmodSync(backupRoot, 0o700)
    const timestamp = new Date().toISOString().replaceAll(/[:.]/g, '-')
    const backupPath = path.join(backupRoot, `server-env-${timestamp}.bak`)
    fs.writeFileSync(backupPath, originalContent, { mode: 0o600, flag: 'wx' })

    const envDirectory = path.dirname(envPath)
    const nextPath = path.join(envDirectory, `.env.rotation-${process.pid}.next`)
    const previousPath = path.join(envDirectory, `.env.rotation-${process.pid}.previous`)
    fs.writeFileSync(nextPath, nextContent, { mode: 0o600, flag: 'wx' })
    fs.chmodSync(nextPath, 0o600)
    let envMoved = false
    let envInstalled = false
    try {
      await prisma.$transaction(async tx => {
        for (const account of rotated) {
          const updated = await tx.ojAccount.updateMany({
            where: { id: account.id, password: account.previousPassword, passwordIV: account.previousIv },
            data: { password: account.password, passwordIV: account.passwordIV },
          })
          if (updated.count !== 1) throw new Error(`OJ account ${account.id} changed during key rotation`)
        }
        fs.renameSync(envPath, previousPath)
        envMoved = true
        fs.renameSync(nextPath, envPath)
        fs.chmodSync(envPath, 0o600)
        envInstalled = true
      }, { timeout: 60_000 })
      fs.rmSync(previousPath, { force: true })
    } catch (error) {
      if (envMoved) {
        if (envInstalled) fs.rmSync(envPath, { force: true })
        if (!fs.existsSync(envPath) && fs.existsSync(previousPath)) fs.renameSync(previousPath, envPath)
      }
      fs.rmSync(nextPath, { force: true })
      throw error
    }

    console.log(JSON.stringify({
      mode: 'apply',
      rotatedAccounts: rotated.length,
      serverEnvInstalledInsideRepository: fs.realpathSync(envPath).startsWith(`${repositoryRoot}${path.sep}`),
      serverEnvMode: (fs.statSync(envPath).mode & 0o777).toString(8),
      backupCreated: true,
      jwtLength: newJwtSecret.length,
      accountKeyHexLength: newAccountKeyText.length,
      corsOriginCount: corsOrigins.split(',').filter(Boolean).length,
    }, null, 2))
  } finally {
    await prisma.$disconnect()
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
