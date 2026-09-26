import { redirect } from 'next/navigation'
import { getServerSession } from '@/lib/serverSession'
import { IdentityChooser } from '@/features/workspace'

interface IdentityPageProps {
  searchParams?: Promise<{
    organizationUnavailable?: string | string[]
    reason?: string | string[]
  }>
}

export default async function IdentityPage({ searchParams }: IdentityPageProps) {
  const session = await getServerSession()
  if (session.state !== 'authenticated') redirect('/login?next=/identity')
  const resolved = await searchParams
  const unavailable = Array.isArray(resolved?.organizationUnavailable) ? resolved.organizationUnavailable[0] : resolved?.organizationUnavailable
  const reason = Array.isArray(resolved?.reason) ? resolved.reason[0] : resolved?.reason
  return <IdentityChooser user={session.user} unavailableReason={unavailable === '1' ? reason || 'UNKNOWN' : undefined} />
}
