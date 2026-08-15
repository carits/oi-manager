import { PlannedFeaturePage } from '@/components/feature/PlannedFeaturePage'

export default function PlatformContributionsPage() {
  return <PlannedFeaturePage feature="contributions" endpoint="/api/contributions/platform" scope="平台管理" />
}
