export const ORGANIZATION_CONTEXT_ERROR_CODES = new Set([
  'ORGANIZATION_NOT_AVAILABLE',
  'ORGANIZATION_ACCESS_DENIED',
  'ORGANIZATION_AUTHORIZATION_INCOMPLETE',
])

export function buildServerSessionHeaders(
  cookieHeader: string,
  organizationId?: string,
): Record<string, string> {
  const headers: Record<string, string> = { Cookie: cookieHeader }
  if (organizationId) headers['X-OI-Organization-ID'] = organizationId
  return headers
}

export function isOrganizationContextDenied(
  status: number,
  code: unknown,
  organizationId?: string,
): code is string {
  return Boolean(
    organizationId
      && (status === 403 || status === 404)
      && typeof code === 'string'
      && ORGANIZATION_CONTEXT_ERROR_CODES.has(code),
  )
}

