import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const serverRoot = path.join(root, 'apps/server')
const migrationsRoot = path.join(serverRoot, 'prisma/migrations')
const baselinesRoot = path.join(serverRoot, 'prisma/baselines')
const currentPath = path.join(baselinesRoot, 'current.json')
const canonicalText = value => String(value).replace(/\r\n?/g, '\n')
const sha256Text = value => crypto.createHash('sha256').update(canonicalText(value), 'utf8').digest('hex')

if (!fs.existsSync(currentPath)) throw new Error('Missing prisma/baselines/current.json')
const pointer = JSON.parse(fs.readFileSync(currentPath, 'utf8'))
if (pointer.schemaVersion !== 1 || !/^\d{8}_[a-z0-9_]+$/.test(pointer.epoch || '')) {
  throw new Error('Invalid current database baseline pointer')
}

const baselineRoot = path.join(baselinesRoot, pointer.epoch)
const manifestPath = path.join(baselineRoot, 'manifest.json')
const snapshotPath = path.join(baselineRoot, 'schema.sql')
if (!fs.existsSync(manifestPath) || !fs.existsSync(snapshotPath)) throw new Error(`Incomplete database baseline ${pointer.epoch}`)
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
const snapshot = fs.readFileSync(snapshotPath, 'utf8')
if (manifest.schemaVersion !== 1 || manifest.epoch !== pointer.epoch) throw new Error('Baseline manifest identity does not match current pointer')
if (sha256Text(snapshot) !== manifest.snapshotSha256) throw new Error(`Baseline snapshot checksum mismatch for ${pointer.epoch}`)

const known = new Map(manifest.migrations.map(migration => [migration.name, migration.checksum]))
if (known.size !== manifest.migrationCount || manifest.migrations.length !== manifest.migrationCount) {
  throw new Error('Baseline migration count or identities are inconsistent')
}
if (manifest.migrations.at(-1)?.name !== manifest.latestMigration) throw new Error('Baseline latestMigration is inconsistent')

const currentMigrations = fs.readdirSync(migrationsRoot, { withFileTypes: true })
  .filter(entry => entry.isDirectory() && /^[A-Za-z0-9_]+$/.test(entry.name))
  .map(entry => ({ name: entry.name, file: path.join(migrationsRoot, entry.name, 'migration.sql') }))
  .filter(entry => fs.existsSync(entry.file))
  .sort((left, right) => left.name.localeCompare(right.name))

for (const [name, checksum] of known) {
  const current = currentMigrations.find(migration => migration.name === name)
  if (!current) throw new Error(`Baseline migration is missing: ${name}`)
  if (sha256Text(fs.readFileSync(current.file, 'utf8')) !== checksum) throw new Error(`Historical migration checksum changed: ${name}`)
}
const future = currentMigrations.filter(migration => !known.has(migration.name))
for (const migration of future) {
  if (migration.name.localeCompare(manifest.latestMigration) <= 0) {
    throw new Error(`Post-baseline migration must sort after ${manifest.latestMigration}: ${migration.name}`)
  }
}

const supplement = fs.readFileSync(path.join(serverRoot, 'prisma/bootstrap/supplement.sql'), 'utf8')
if (sha256Text(supplement) !== manifest.supplementSha256) {
  throw new Error('Frozen bootstrap supplement changed; express new invariants in an append-only migration')
}

console.log(JSON.stringify({
  epoch: manifest.epoch,
  baselineMigrations: manifest.migrationCount,
  postBaselineMigrations: future.length,
  snapshotSha256: manifest.snapshotSha256,
  productionSchemaSignatureSha256: manifest.productionSchemaSignatureSha256,
  valid: true,
}, null, 2))
