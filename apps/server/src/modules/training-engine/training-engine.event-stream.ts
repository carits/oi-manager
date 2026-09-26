export function resolveTrainingEventStreamOrganizationId(value: unknown) {
  if (typeof value !== 'string') return null
  const organizationId = value.trim()
  return organizationId || null
}
