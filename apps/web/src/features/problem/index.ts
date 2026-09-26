import dynamic from 'next/dynamic'

export const ProblemDetail = dynamic(() => import('./ui/ProblemDetail').then(module => module.ProblemDetail))
export const ProblemForm = dynamic(() => import('./ui/ProblemForm').then(module => module.ProblemForm))
export const ProblemList = dynamic(() => import('./ui/ProblemList').then(module => module.ProblemList))
export const ProblemNote = dynamic(() => import('./ui/ProblemNote').then(module => module.ProblemNote))
export const ProblemListPage = dynamic(() => import('./ui/ProblemListPage'))
export const ProblemListDetailPage = dynamic(() => import('./ui/ProblemListDetailPage'))
export const NewProblemListPage = dynamic(() => import('./ui/NewProblemListPage'))
export const PlatformProblemManagementPage = dynamic(() =>
  import('./ui/PlatformProblemManagementPage').then(module => module.PlatformProblemManagementPage)
)

export { listProblemLists } from './api/problemListApi'
