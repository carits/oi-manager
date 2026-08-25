'use client'

import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Input, Select, Textarea } from '@/components/ui/FormControls'
import { useAuth } from '@/components/AuthProvider'
import { currentWorkspacePrefix } from '@/lib/workspacePath'
import { useResource } from '@/hooks/useResource'
import TeamTrainingList from '@/components/training/TeamTrainingList'
import { AsyncRegion } from '@/components/ui/AsyncRegion'
import { PageFrame } from '@/components/ui/PageFrame'
import { PageHeader } from '@/components/ui/PageHeader'
import { Toolbar, ToolbarGroup } from '@/components/ui/Toolbar'
import styles from '@/components/TrainingIndex.module.css'

interface Team { id: string; name: string }
interface TeamPayload { items?: Team[]; data?: Team[] }
function normalizeTeams(payload: TeamPayload | Team[] | undefined) { return Array.isArray(payload) ? payload : payload?.items || payload?.data || [] }

export default function TeacherContestsPage() {
  const { sessionKey } = useAuth()
  const router = useRouter()
  const pathname = usePathname()
  const { organizationId } = useParams<{ organizationId?: string }>()
  const pathPrefix = currentWorkspacePrefix(pathname, '/personal/contests', '/contests')
  const searchParams = useSearchParams()
  const resource = useResource<TeamPayload | Team[]>('/api/teams?view=mine&pageSize=100', { sessionKey, isEmpty: data => normalizeTeams(data).length === 0 && !organizationId, dedupingInterval: 30000 })
  const teams = normalizeTeams(resource.data)
  const scopeOptions = [...(organizationId ? [{ value: 'organization:' + organizationId, label: '校园比赛' }] : []), ...teams.map(team => ({ value: 'team:' + team.id, label: team.name }))]
  const requestedScope = searchParams.get('scope')
  const activeScope = scopeOptions.some(option => option.value === requestedScope) ? requestedScope! : scopeOptions[0]?.value
  const setScope = (scope: string) => { const params = new URLSearchParams(searchParams.toString()); params.set('scope', scope); router.replace(pathPrefix + '/contests?' + params, { scroll: false }) }
  const [scopeType, scopeId] = activeScope?.split(':') || []

  return (
    <PageFrame>
      <PageHeader title='比赛' description='在团队和校园范围之间切换，维护对应比赛。' />
      <AsyncRegion state={resource.state} onRetry={resource.retry} emptyText='暂无可管理的比赛范围' skeletonRows={5}>
        {() => <>
          <Toolbar><ToolbarGroup><label htmlFor='contest-scope' className={styles.summary}>比赛范围</label><Select id='contest-scope' className={styles.scopeSelect} value={activeScope} onChange={event => setScope(event.target.value)}>{scopeOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</Select></ToolbarGroup><span className={styles.summary}>不同范围的数据彼此独立</span></Toolbar>
          {scopeType === 'organization' && scopeId ? <TeamTrainingList organizationId={scopeId} basePath={pathPrefix} isAdmin mode='contest' /> : scopeType === 'team' && scopeId ? <TeamTrainingList teamId={scopeId} basePath={pathPrefix + '/teams'} isAdmin mode='contest' /> : null}
        </>}
      </AsyncRegion>
    </PageFrame>
  )
}
