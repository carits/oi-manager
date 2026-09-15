import { NotificationContracts, type NotificationFilter, type UserNotification } from '@oi-manager/contracts'
import { accountClient, apiClient, organizationClient } from '@/lib/apiClient'

function queryString(input: Record<string, string | number | undefined>) {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) query.set(key, String(value))
  }
  const encoded = query.toString()
  return encoded ? `?${encoded}` : ''
}

export function listContextNotifications(pageSize = 10) {
  return apiClient.queryContract(NotificationContracts.list, `/api/notifications${queryString({ pageSize })}`)
}

export function listAccountNotifications(filter: NotificationFilter, page: number, pageSize = 50) {
  return accountClient.queryContract(NotificationContracts.list, `/api/notifications${queryString({ view: 'account', filter, page, pageSize })}`)
}

export function readContextNotification(id: string) {
  return apiClient.mutateContract(NotificationContracts.read, `/api/notifications/${encodeURIComponent(id)}/read`, {})
}

export function readAccountNotification(id: string) {
  return accountClient.mutateContract(NotificationContracts.read, `/api/notifications/${encodeURIComponent(id)}/read?view=account`, {})
}

export function readAllContextNotifications() {
  return apiClient.mutateContract(NotificationContracts.readAll, '/api/notifications/read-all', {})
}

export function readAllAccountNotifications() {
  return accountClient.mutateContract(NotificationContracts.readAll, '/api/notifications/read-all?view=account', {})
}

export async function respondToNotification(notification: UserNotification, action: string) {
  if (action === 'view') throw new Error('view is a navigation action')
  const client = notification.organizationId ? organizationClient(notification.organizationId) : accountClient
  if (notification.type === 'organization_invitation') {
    return accountClient.mutate<unknown>(
      `/api/organization-invitations/${encodeURIComponent(notification.sourceId)}/${action}`,
      'POST',
      {},
    )
  }
  if (notification.type === 'team_invitation') {
    const normalizedAction = action === 'decline' ? 'reject' : action
    return client.mutate<unknown>(`/api/teams/invitations/${encodeURIComponent(notification.sourceId)}/${normalizedAction}`, 'POST', {})
  }
  return client.mutate<unknown>(`/api/teams/join-requests/${encodeURIComponent(notification.sourceId)}/${action}`, 'POST', {})
}
