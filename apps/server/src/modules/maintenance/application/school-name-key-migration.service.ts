import { prisma } from '../../../prisma'
import { lockSchoolCreation, normalizeSchoolName } from '../../organization/application/school-creation.service'

export async function inspectSchoolNameKeyMigration() {
  const schools = await prisma.school.findMany({ select: { id: true, name: true, nameKey: true, organizationId: true }, orderBy: { createdAt: 'asc' } })
  const groups = new Map<string, typeof schools>()
  for (const school of schools) {
    const key = normalizeSchoolName(school.name)
    groups.set(key, [...(groups.get(key) || []), school])
  }
  return {
    total: schools.length,
    missing: schools.filter(school => !school.nameKey).length,
    mismatched: schools.filter(school => school.nameKey && school.nameKey !== normalizeSchoolName(school.name)).map(school => school.id),
    collisions: [...groups.entries()].filter(([, rows]) => rows.length > 1).map(([nameKey, rows]) => ({ nameKey, schools: rows.map(row => ({ id: row.id, name: row.name, organizationId: row.organizationId })) })),
  }
}

export async function applySchoolNameKeyMigration() {
  return prisma.$transaction(async tx => {
    await lockSchoolCreation(tx)
    const schools = await tx.school.findMany({ select: { id: true, name: true, nameKey: true } })
    const seen = new Map<string, string>()
    for (const school of schools) {
      const key = normalizeSchoolName(school.name)
      if (seen.has(key)) throw new Error(`学校名称标准化冲突：${seen.get(key)} 与 ${school.id}`)
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
