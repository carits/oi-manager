import { redirect } from 'next/navigation'
import { getServerSession } from '@/lib/serverSession'
import { IdentityChooser } from './IdentityChooser'

export default async function IdentityPage() {
  const session = await getServerSession()
  if (session.state !== 'authenticated') redirect('/login?next=/identity')
  return <IdentityChooser user={session.user} />
}
