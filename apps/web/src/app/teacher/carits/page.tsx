import { redirect } from 'next/navigation'

export default function LegacyRedirectPage() {
  redirect('/account/wallet')
}
