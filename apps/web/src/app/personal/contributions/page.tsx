import { PlannedFeaturePage } from '@/components/feature/PlannedFeaturePage'

export default function PersonalContributionsPage() {
  return <PlannedFeaturePage feature="contributions" endpoint="/api/contributions/me/summary" scope="个人" />
}
