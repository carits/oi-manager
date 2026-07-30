export type AppRole =
  | 'super_admin'
  | 'platform_admin'
  | 'school_principal'
  | 'teacher'
  | 'student'

export function getRoleHome(role?: string): string {
  switch (role) {
    case 'super_admin':
      return '/admin/schools'
    case 'platform_admin':
      return '/platform-admin'
    case 'school_principal':
    case 'teacher':
      return '/teacher'
    case 'student':
      return '/student'
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
