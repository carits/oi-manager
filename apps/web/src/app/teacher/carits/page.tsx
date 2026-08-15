import { PlannedFeaturePage } from '@/components/feature/PlannedFeaturePage'

export default function TeacherCaritsPage() {
  return <PlannedFeaturePage feature="carits" endpoint="/api/carits/me" scope="校园" />
}
