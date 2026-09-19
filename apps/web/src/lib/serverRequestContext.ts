type ContextRoleUser = {
  accountRole?: string | null
  organizationRole?: string | null
}

export function validOrganizationContextId(value: string): string | undefined {
  return /^[A-Za-z0-9_-]{1,160}$/.test(value) ? value : undefined
}

export function organizationIdFromRequestPath(requestedPath: string): string | undefined {
  const pathname = requestedPath.split('?')[0]
  const encodedId = pathname.match(/^\/org\/([^/]+)(?:\/|$)/)?.[1]
  if (!encodedId) return undefined

  try {
    const organizationId = decodeURIComponent(encodedId)
    return validOrganizationContextId(organizationId)
  } catch {
    return undefined
  }
}

export function authorizationRoleForContext(
  user: ContextRoleUser,
  requiredContext?: 'organization' | 'personal' | 'platform',
): string | undefined {
  if (requiredContext === 'organization') return user.organizationRole || undefined
  if (requiredContext === 'personal' || requiredContext === 'platform') {
    return user.accountRole || undefined
  }
  return user.organizationRole || user.accountRole || undefined
}
