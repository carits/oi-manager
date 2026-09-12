import { redirect } from 'next/navigation'

export default async function PersonalContestStatementsPage({ params }: { params: Promise<{ cid: string }> }) {
  const { cid } = await params
  redirect(`/personal/contests/${cid}/statements`)
}
