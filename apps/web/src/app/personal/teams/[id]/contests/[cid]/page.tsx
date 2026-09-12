import { redirect } from 'next/navigation'

export default async function PersonalTeamContestDetailPage({ params }: { params: Promise<{ cid: string }> }) {
  const { cid } = await params
  redirect(`/personal/contests/${cid}`)
}
