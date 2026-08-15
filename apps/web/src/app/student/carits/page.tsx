import { PlannedFeaturePage } from '@/components/feature/PlannedFeaturePage'

export default function StudentCaritsPage() {
  return <PlannedFeaturePage feature="carits" endpoint="/api/carits/me" scope="校园" />
}
