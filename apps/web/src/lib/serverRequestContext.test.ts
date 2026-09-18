import { describe, expect, it } from 'vitest'
import {
  authorizationRoleForContext,
  organizationIdFromRequestPath,
  validOrganizationContextId,
} from './serverRequestContext'

describe('server request organization context', () => {
  it('extracts only valid organization ids from organization routes', () => {
    expect(organizationIdFromRequestPath('/org/school-1/overview?tab=members')).toBe('school-1')
    expect(organizationIdFromRequestPath('/personal')).toBeUndefined()
    expect(organizationIdFromRequestPath('/org/%0d%0aevil/overview')).toBeUndefined()
    expect(validOrganizationContextId('school_A-1')).toBe('school_A-1')
    expect(validOrganizationContextId('school/A')).toBeUndefined()
  })

  it('uses organization membership role only in organization context', () => {
    const user = { accountRole: 'user', organizationRole: 'teacher', role: 'teacher' }
    expect(authorizationRoleForContext(user, 'organization')).toBe('teacher')
    expect(authorizationRoleForContext(user, 'personal')).toBe('user')
    expect(authorizationRoleForContext(user, 'platform')).toBe('user')
    expect(authorizationRoleForContext(user)).toBe('teacher')
  })
})
