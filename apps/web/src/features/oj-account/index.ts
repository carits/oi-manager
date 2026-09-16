import dynamic from 'next/dynamic'

export const OjAccountManagementPage = dynamic(() =>
  import('./ui/OjAccountManagementPage').then(module => module.OjAccountManagementPage)
)
