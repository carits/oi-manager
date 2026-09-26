export * from './api/contestApi'
import dynamic from 'next/dynamic'

export const PlatformContestListPage = dynamic(() => import('./ui/PlatformContestListPage').then(module => module.PlatformContestListPage))
export const TeamContestList = dynamic(() => import('./ui/TeamContestList'))
export const ContestDetailPage = dynamic(() => import('./ui/ContestDetailPage').then(module => module.ContestDetailPage))
export const ContestFormModal = dynamic(() => import('./ui/ContestFormModal').then(module => module.ContestFormModal))
export const ContestStatementManagementPage = dynamic(() => import('./ui/ContestStatementManagementPage').then(module => module.ContestStatementManagementPage))
