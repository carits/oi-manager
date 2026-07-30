import { LoginForm } from './LoginForm'
import { normalizeLoginRole } from '@/lib/loginRole'

interface LoginPageProps {
  searchParams?: {
    role?: string | string[]
  }
}

export default function LoginPage({ searchParams }: LoginPageProps) {
  const rawRole = Array.isArray(searchParams?.role)
    ? searchParams?.role[0]
    : searchParams?.role

  return <LoginForm initialRole={normalizeLoginRole(rawRole)} />
}
