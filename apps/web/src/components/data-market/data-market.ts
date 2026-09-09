import { isGlobalAdministrator } from '@/lib/capabilities'

export type DataLicense = 'PERSONAL' | 'ORGANIZATION' | 'CONTEST'

export function canManageDataMarketplace(role?: string, organizationRole?: string | null) {
  return isGlobalAdministrator(role) || organizationRole === 'teacher' || organizationRole === 'school_principal'
}

export function buildDataPurchasePayload(license: DataLicense, organizationId: string, contestId: string) {
  if (license === 'ORGANIZATION') return { license, organizationId }
  if (license === 'CONTEST') return { license, contestId: Number(contestId) }
  return { license }
}

export function canRequestDataUpgrade(updatePolicy: string) {
  return updatePolicy !== 'SNAPSHOT'
}
