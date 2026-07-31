import { LoginForm } from './LoginForm'
import { normalizeLoginRole } from '@/lib/loginRole'
import { redirect } from 'next/navigation'
import { getRoleHome } from '@/lib/roleAccess'
import { getServerSession } from '@/lib/serverSession'

interface LoginPageProps {
  searchParams?: {
    role?: string | string[]
    next?: string | string[]
  }
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const session = await getServerSession()
  if (session.state === 'authenticated') {
    redirect(getRoleHome(session.user.role))
  }

  const rawRole = Array.isArray(searchParams?.role)
    ? searchParams?.role[0]
    : searchParams?.role
  const rawNext = Array.isArray(searchParams?.next)
    ? searchParams?.next[0]
    : searchParams?.next
  const nextPath = rawNext?.startsWith('/') && !rawNext.startsWith('//')
    ? rawNext
    : undefined

  return <LoginForm initialRole={normalizeLoginRole(rawRole)} nextPath={nextPath} />
}
