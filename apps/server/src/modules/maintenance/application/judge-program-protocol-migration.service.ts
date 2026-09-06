import crypto from 'crypto'
import { defaultProtocolFor, isJudgeProgramCombinationAllowed, type JudgeProgramKind, type JudgeProgramLanguage } from '@oi-manager/shared'
import { prisma } from '../../../prisma'

function hash(rows: Array<{ id: string; kind: string; language: string; protocol: string; currentVersionId: string | null }>) {
  return crypto.createHash('sha256').update(JSON.stringify(rows.map(row => [row.id, row.kind, row.language, row.protocol, row.currentVersionId]))).digest('hex')
}

export async function inspectJudgeProgramProtocolMigration() {
  const versions = await prisma.problemJudgeProgramVersion.findMany({ include: { Program: { select: { kind: true, currentVersionId: true } } }, orderBy: { id: 'asc' } })
  const rows = versions.map(version => ({ id: version.id, kind: version.Program.kind, language: version.language, protocol: version.protocol, currentVersionId: version.Program.currentVersionId }))
  const ambiguous = rows.filter(row => !defaultProtocolFor(row.kind as JudgeProgramKind, row.language as JudgeProgramLanguage) && !(row.kind === 'generator' && row.language === 'cpp17'))
  const pending = rows.filter(row => row.protocol === 'legacy')
  return {
    reportHash: hash(rows), total: rows.length, pending: pending.length, ambiguous: ambiguous.length,
    byKind: Object.fromEntries(['standard', 'validator', 'classifier', 'generator'].map(kind => [kind, rows.filter(row => row.kind === kind).length])),
    ambiguousVersions: ambiguous.slice(0, 100).map(row => ({ id: row.id, kind: row.kind, language: row.language })),
  }
}

export async function applyJudgeProgramProtocolMigration(reportHash: string) {
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended('judge-program-protocol-migration', 0)) IS NULL AS locked`
    const versions = await tx.problemJudgeProgramVersion.findMany({ include: { Program: { select: { kind: true, currentVersionId: true } } }, orderBy: { id: 'asc' } })
    const rows = versions.map(version => ({ id: version.id, kind: version.Program.kind, language: version.language, protocol: version.protocol, currentVersionId: version.Program.currentVersionId }))
    if (!reportHash || reportHash !== hash(rows)) throw new Error('检查报告已过期，请重新执行 check')
    const ambiguous = rows.filter(row => !defaultProtocolFor(row.kind as JudgeProgramKind, row.language as JudgeProgramLanguage) && !(row.kind === 'generator' && row.language === 'cpp17'))
    if (ambiguous.length) throw new Error(`存在 ${ambiguous.length} 个无法安全识别的程序版本，本次未修改任何记录`)
    let updated = 0
    for (const row of rows) {
      if (row.protocol !== 'legacy') continue
      const protocol = row.kind === 'generator' ? 'legacy-args-v1' : defaultProtocolFor(row.kind as JudgeProgramKind, row.language as JudgeProgramLanguage)!
      if (!isJudgeProgramCombinationAllowed(row.kind, row.language, protocol, true)) throw new Error(`版本 ${row.id} 的协议组合无效`)
      const active = row.currentVersionId === row.id
      const result = await tx.problemJudgeProgramVersion.updateMany({ where: { id: row.id, protocol: 'legacy' }, data: { protocol, protocolVersion: 1, lifecycleStatus: active ? 'active' : 'compiled', activatedAt: active ? new Date() : null } })
      updated += result.count
    }
    return { total: rows.length, updated, ambiguous: 0 }
  }, { isolationLevel: 'Serializable' })
}
