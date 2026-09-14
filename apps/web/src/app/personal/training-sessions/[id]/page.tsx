'use client'
import { useParams } from 'next/navigation'
import { TrainingSessionWorkspace } from '@/features/training-session/TrainingSessionWorkspace'
export default function PersonalTrainingSessionPage() { const { id } = useParams<{ id: string }>(); return <TrainingSessionWorkspace sessionId={id} /> }
