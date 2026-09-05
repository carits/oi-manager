import { prisma } from '../../../prisma'
import { lockSchoolCreation, normalizeSchoolName } from '../../organization/application/school-creation.service'

export async function inspectSchoolNameKeyMigration() {
  const schools = await prisma.school.findMany({ where: { directoryStatus: { not: 'legacy' } }, select: { id: true, name: true, nameKey: true, organizationId: true }, orderBy: { createdAt: 'asc' } })
  const groups = new Map<string, typeof schools>()
  for (const school of schools) {
    const key = normalizeSchoolName(school.name)
    groups.set(key, [...(groups.get(key) || []), school])
  }
  const collisionGroups = [...groups.entries()].filter(([, rows]) => rows.length > 1)
  return {
    total: schools.length,
    missing: schools.filter(school => !school.nameKey).length,
    mismatched: schools.filter(school => school.nameKey && school.nameKey !== normalizeSchoolName(school.name)).map(school => school.id),
    collisionGroupCount: collisionGroups.length,
    collisionSchoolCount: collisionGroups.reduce((sum, [, rows]) => sum + rows.length, 0),
    collisions: collisionGroups.slice(0, 20).map(([nameKey, rows]) => ({
      nameKey,
      schools: rows.slice(0, 10).map(row => ({ id: row.id, name: row.name, organizationId: row.organizationId })),
      omitted: Math.max(0, rows.length - 10),
    })),
    collisionGroupsOmitted: Math.max(0, collisionGroups.length - 20),
  }
}

export async function applySchoolNameKeyMigration() {
  return prisma.$transaction(async tx => {
    await lockSchoolCreation(tx)
    const schools = await tx.school.findMany({ where: { directoryStatus: { not: 'legacy' } }, select: { id: true, name: true, nameKey: true } })
    const seen = new Map<string, string>()
    for (const school of schools) {
      const key = normalizeSchoolName(school.name)
      if (seen.has(key)) throw new Error('学校名称标准化存在冲突，请先根据 check 报告人工处理，本次未回填任何记录')
      seen.set(key, school.id)
    }
    let updated = 0
    for (const school of schools) {
      const nameKey = normalizeSchoolName(school.name)
      if (school.nameKey === nameKey) continue
      const result = await tx.school.updateMany({ where: { id: school.id, nameKey: school.nameKey }, data: { nameKey } })
      updated += result.count
    }
    return { total: schools.length, updated, collisions: 0 }
  }, { isolationLevel: 'Serializable' })
}
