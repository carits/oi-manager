import { PlannedFeaturePage } from '@/components/feature/PlannedFeaturePage'

export default function PersonalCaritsPage() {
  return <PlannedFeaturePage feature="carits" endpoint="/api/carits/me" scope="个人" />
}
