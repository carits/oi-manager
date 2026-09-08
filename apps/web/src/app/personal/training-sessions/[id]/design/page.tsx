'use client'

import { useParams } from 'next/navigation'
import { TrainingSessionDesigner } from '@/components/training-engine/TrainingSessionDesigner'

export default function PersonalTrainingSessionDesignPage() {
  const { id } = useParams<{ id: string }>()
  return <TrainingSessionDesigner sessionId={id} />
}
