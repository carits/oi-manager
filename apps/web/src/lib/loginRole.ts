export type LoginRole = 'teacher' | 'student' | 'admin'

export function normalizeLoginRole(role?: string): LoginRole {
  switch (role) {
    case 'student':
      return 'student'
    case 'admin':
    case 'platform-admin':
    case 'platform_admin':
    case 'super_admin':
      return 'admin'
    case 'teacher':
    case 'school_principal':
    default:
      return 'teacher'
  }
}
