import { describe, expect, it } from 'vitest'
import { resolveTrainingEventStreamOrganizationId } from '../src/modules/training-engine/training-engine.event-stream'

describe('training event stream organization context', () => {
  it('accepts and trims a single organization id', () => {
    expect(resolveTrainingEventStreamOrganizationId(' org_school-default ')).toBe('org_school-default')
  })

  it('rejects missing, empty, and repeated query values', () => {
    expect(resolveTrainingEventStreamOrganizationId(undefined)).toBeNull()
    expect(resolveTrainingEventStreamOrganizationId('   ')).toBeNull()
    expect(resolveTrainingEventStreamOrganizationId(['org-a', 'org-b'])).toBeNull()
  })
})
