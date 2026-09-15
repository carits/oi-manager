import { LoginForm } from '@/features/auth'
import { redirect } from 'next/navigation'
import { getServerSession } from '@/lib/serverSession'

interface LoginPageProps {
  searchParams?: Promise<{
    role?: string | string[]
    next?: string | string[]
  }>
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const resolvedSearchParams = await searchParams
  const rawNext = Array.isArray(resolvedSearchParams?.next)
    ? resolvedSearchParams?.next[0]
    : resolvedSearchParams?.next
  const nextPath = rawNext?.startsWith('/') && !rawNext.startsWith('//')
    ? rawNext
    : undefined

  const session = await getServerSession()
  if (session.state === 'authenticated') redirect(nextPath || '/identity')

  return <LoginForm nextPath={nextPath} />
}
