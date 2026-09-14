import dynamic from 'next/dynamic'

export const PlatformContestListPage = dynamic(() => import('./ui/PlatformContestListPage').then(module => module.PlatformContestListPage))
export const TeamTrainingList = dynamic(() => import('./ui/TeamTrainingList'))
export const TrainingDetailPage = dynamic(() => import('./ui/TrainingDetailPage').then(module => module.TrainingDetailPage))
export const TrainingFormModal = dynamic(() => import('./ui/TrainingFormModal').then(module => module.TrainingFormModal))
export const TrainingStatementManagementPage = dynamic(() => import('./ui/TrainingStatementManagementPage').then(module => module.TrainingStatementManagementPage))
