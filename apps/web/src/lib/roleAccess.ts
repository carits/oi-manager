export function getRoleHome(role?: string, context: 'organization' | 'personal' | 'platform' = 'organization'): string {
  if (role === 'super_admin') return '/admin'
  if (role === 'platform_admin') return '/platform-admin'
  if (context === 'personal') return '/personal'
  switch (role) {
    case 'school_principal':
    case 'teacher':
    case 'student':
      return '/identity'
    case 'user':
      return '/personal'
    default:
      return '/login'
  }
}

export function roleHasAccess(
  role: string | undefined,
  requiredRole?: string | string[],
): boolean {
  if (!requiredRole) return true
  if (!role) return false

  const required = Array.isArray(requiredRole) ? requiredRole : [requiredRole]
  return required.some(candidate => {
    if (candidate === role) return true
    if (candidate === 'platform_admin') return role === 'super_admin'
    if (candidate === 'teacher') return role === 'school_principal'
    return false
  })
}
