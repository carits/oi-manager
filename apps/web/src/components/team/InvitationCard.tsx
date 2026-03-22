'use client'

export interface Invitation {
  id: string
  teamId: string
  teamName: string
  schoolName: string
  memberCount?: number
  ownerName?: string
  invitedAt: string
  type: 'admin' | 'member' // 管理员邀请 或 成员邀请
}

interface InvitationCardProps {
  invitation: Invitation
  onAccept: (invitationId: string, type: 'admin' | 'member') => void
  onReject: (invitationId: string, type: 'admin' | 'member') => void
  processing?: boolean
}

export function InvitationCard({ invitation, onAccept, onReject, processing }: InvitationCardProps) {
  const isMember = invitation.type === 'member'

  return (
    <div
      style={{
        background: isMember ? '#dbeafe' : '#fef3c7',
        border: isMember ? '1px solid #93c5fd' : '1px solid #fcd34d',
        borderRadius: '8px',
        padding: '1rem',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '1rem'
      }}
    >
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 500, marginBottom: '0.25rem' }}>
          <span style={{ color: 'var(--primary)' }}>{invitation.teamName}</span>
          <span style={{ color: 'var(--gray-600)', marginLeft: '0.5rem' }}>
            {isMember ? '邀请您成为成员' : '邀请您成为管理员'}
          </span>
        </div>
        <div style={{ fontSize: '0.75rem', color: 'var(--gray-500)' }}>
          {invitation.schoolName}
          {invitation.ownerName && <span style={{ marginLeft: '0.5rem' }}>· 所有者: {invitation.ownerName}</span>}
        </div>
      </div>
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <button
          onClick={() => onAccept(invitation.id, invitation.type)}
          disabled={processing}
          style={{
            padding: '0.375rem 0.75rem',
            background: 'var(--primary)',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            cursor: processing ? 'not-allowed' : 'pointer',
            fontSize: '0.875rem',
            opacity: processing ? 0.6 : 1
          }}
        >
          接受
        </button>
        <button
          onClick={() => onReject(invitation.id, invitation.type)}
          disabled={processing}
          style={{
            padding: '0.375rem 0.75rem',
            background: 'white',
            color: 'var(--gray-700)',
            border: '1px solid var(--border)',
            borderRadius: '6px',
            cursor: processing ? 'not-allowed' : 'pointer',
            fontSize: '0.875rem',
            opacity: processing ? 0.6 : 1
          }}
        >
          拒绝
        </button>
      </div>
    </div>
  )
}
