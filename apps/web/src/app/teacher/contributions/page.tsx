import { PlannedFeaturePage } from '@/components/feature/PlannedFeaturePage'

export default function TeacherContributionsPage() {
  return <PlannedFeaturePage feature="contributions" endpoint="/api/contributions/me/summary" scope="校园" />
}
