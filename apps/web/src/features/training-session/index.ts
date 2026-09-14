export * from './api/trainingSessionApi'
import dynamic from 'next/dynamic'

export const TrainingSessionDesigner = dynamic(() => import('./ui/TrainingSessionDesigner').then(module => module.TrainingSessionDesigner))
export const TrainingSessionListPage = dynamic(() => import('./ui/TrainingSessionListPage').then(module => module.TrainingSessionListPage))
export const TrainingSessionWorkspace = dynamic(() => import('./ui/TrainingSessionWorkspace').then(module => module.TrainingSessionWorkspace))
