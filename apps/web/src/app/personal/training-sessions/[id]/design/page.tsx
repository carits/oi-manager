'use client'

import { useParams } from 'next/navigation'
import { TrainingSessionDesigner } from '@/features/training-session/TrainingSessionDesigner'

export default function PersonalTrainingSessionDesignPage() {
  const { id } = useParams<{ id: string }>()
  return <TrainingSessionDesigner sessionId={id} />
}
