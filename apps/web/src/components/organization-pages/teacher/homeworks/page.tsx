'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useAuth } from '@/components/AuthProvider'
import { useResource } from '@/hooks/useResource'
import TeamTrainingList from '@/components/training/TeamTrainingList'
import { AsyncRegion } from '@/components/ui/AsyncRegion'
import { PageFrame } from '@/components/ui/PageFrame'
import { PageHeader } from '@/components/ui/PageHeader'
import { Toolbar, ToolbarGroup } from '@/components/ui/Toolbar'
import styles from '@/components/TrainingIndex.module.css'
import { currentWorkspacePrefix } from '@/lib/workspacePath'

interface Team { id: string; name: string }
interface TeamPayload { items?: Team[]; data?: Team[] }
function normalizeTeams(payload: TeamPayload | Team[] | undefined) { return Array.isArray(payload) ? payload : payload?.items || payload?.data || [] }

export default function TeacherHomeworksPage() {
  const { sessionKey } = useAuth()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const pathPrefix = currentWorkspacePrefix(pathname, '/personal/homeworks', '/homeworks')
  const resource = useResource<TeamPayload | Team[]>('/api/teams?view=mine&pageSize=100', { sessionKey, isEmpty: data => normalizeTeams(data).length === 0, dedupingInterval: 30000 })
  const teams = normalizeTeams(resource.data)
  const requestedTeam = searchParams.get('team')
  const activeTeamId = teams.some(team => team.id === requestedTeam) ? requestedTeam! : teams[0]?.id
  const setTeam = (teamId: string) => { const params = new URLSearchParams(searchParams.toString()); params.set('team', teamId); router.replace(`${pathPrefix}?${params}`, { scroll: false }) }

  return (
    <PageFrame>
      <PageHeader title="作业" description="选择团队后查看、创建和维护作业。" />
      <AsyncRegion state={resource.state} onRetry={resource.retry} emptyText="暂无团队，请先创建团队" skeletonRows={5}>
        {() => <>
          <Toolbar><ToolbarGroup><label htmlFor="homework-team" className={styles.summary}>团队范围</label><select id="homework-team" className={styles.scopeSelect} value={activeTeamId} onChange={event => setTeam(event.target.value)}>{teams.map(team => <option key={team.id} value={team.id}>{team.name}</option>)}</select></ToolbarGroup><span className={styles.summary}>作业只显示在所选团队内</span></Toolbar>
          {activeTeamId && <TeamTrainingList teamId={activeTeamId} basePath={currentWorkspacePrefix(pathname, '/personal/teams', '/teams')} isAdmin mode="homework" />}
        </>}
      </AsyncRegion>
    </PageFrame>
  )
}
