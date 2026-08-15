import { redirect } from 'next/navigation'

export default function LegacyRedirectPage() {
  redirect('/teacher/rankings?tab=contribution')
}
