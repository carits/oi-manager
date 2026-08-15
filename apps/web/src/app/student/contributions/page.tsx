import { redirect } from 'next/navigation'

export default function LegacyRedirectPage() {
  redirect('/student/rating?tab=contribution')
}
