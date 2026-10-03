'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createTeam as createTeamRequest, listMyTeamInvitations, respondToTeamInvitation, TeamListPage, type Invitation, type TeamItem } from '@/features/team'
import { useAuth } from '@/features/auth'
import { useTeams, type Team } from '@/features/team'
import { useToast } from '@/components/ui/Toast'

type TeamTab = 'mine' | 'all'
type InvitationPayload = Omit<Invitation, 'type'>

export default function PersonalTeamsPage() {
  const { sessionKey } = useAuth()
  const router = useRouter()
  const searchParams = useSearchParams()
  const toast = useToast()
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(12)
  const [activeTab, setActiveTab] = useState<TeamTab>(searchParams.get('tab') === 'all' ? 'all' : 'mine')
  const [invitations, setInvitations] = useState<Invitation[]>([])
  const [loadingInvitations, setLoadingInvitations] = useState(true)
  const [processingInvitation, setProcessingInvitation] = useState<string | null>(null)
  const [createModalOpen, setCreateModalOpen] = useState(false)
  const [creating, setCreating] = useState(false)

  const resource = useTeams({
    page,
    pageSize,
    view: activeTab === 'mine' ? 'mine' : 'all',
  }, sessionKey)

  const teams: TeamItem[] = (resource.data?.data || []).map((team: Team) => ({
    id: team.id,
    name: team.name,
    avatar: team.avatar,
    description: team.description,
    isPublic: team.isPublic,
    school: null,
    owner: team.owner,
    _count: team._count,
  }))

  const fetchInvitations = async () => {
    if (!sessionKey) return
    setLoadingInvitations(true)
    try {
      const [memberResult, adminResult] = await Promise.all([
        listMyTeamInvitations('all'),
        listMyTeamInvitations('admin'),
      ])
      const members = memberResult.map(item => ({ ...item, schoolName: '', type: 'member' as const }))
      const admins = adminResult.map(item => ({ ...item, schoolName: '', type: 'admin' as const }))
      setInvitations([...admins, ...members])
    } finally {
      setLoadingInvitations(false)
    }
  }

  useEffect(() => { void fetchInvitations() }, [sessionKey])

  const processInvitation = async (id: string, type: 'admin' | 'member', action: 'accept' | 'reject') => {
    setProcessingInvitation(id)
    try {
      const result = await respondToTeamInvitation(id, action, type === 'admin' ? 'admin' : 'all')
      if (!result.ok) return toast.error(result.error.userMessage || '操作失败')
      setInvitations(current => current.filter(invitation => invitation.id !== id))
      if (action === 'accept') await resource.refetch()
    } finally {
      setProcessingInvitation(null)
    }
  }

  const createTeam = async (form: { name: string; description: string; isPublic: boolean; teamId: string }) => {
    setCreating(true)
    try {
      const result = await createTeamRequest({
        id: form.teamId,
        name: form.name,
        description: form.description,
        isPublic: form.isPublic,
      })
      if (!result.ok) {
        toast.error(result.error.userMessage || '创建失败')
        return false
      }
      toast.success('团队创建成功')
      await resource.refetch()
      return true
    } finally {
      setCreating(false)
    }
  }

  const changeTab = (tab: TeamTab) => {
    setActiveTab(tab)
    setPage(1)
    router.replace(`/personal/teams${tab === 'all' ? '?tab=all' : ''}`, { scroll: false })
  }

  return (
    <TeamListPage
      basePath="/personal/teams"
      teams={teams}
      loading={resource.loading}
      error={resource.error}
      onRetry={resource.refetch}
      page={page}
      pageSize={pageSize}
      total={resource.data?.total || 0}
      totalPages={resource.data?.totalPages || 1}
      onPageChange={setPage}
      onPageSizeChange={size => { setPageSize(size); setPage(1) }}
      activeTab={activeTab}
      onTabChange={changeTab}
      invitations={invitations}
      loadingInvitations={loadingInvitations}
      processingInvitation={processingInvitation}
      onAcceptInvitation={(id, type) => void processInvitation(id, type, 'accept')}
      onRejectInvitation={(id, type) => void processInvitation(id, type, 'reject')}
      showCreateButton
      onCreateTeam={createTeam}
      createModalOpen={createModalOpen}
      onOpenCreateModal={() => setCreateModalOpen(true)}
      onCloseCreateModal={() => setCreateModalOpen(false)}
      creating={creating}
    />
  )
}
