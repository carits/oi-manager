'use client'

import { Button } from '@/components/ui/Button'
import styles from './Team.module.css'

export interface Invitation { id: string; teamId: string; teamName: string; schoolName: string; memberCount?: number; ownerName?: string; invitedAt: string; type: 'admin' | 'member' }
interface InvitationCardProps { invitation: Invitation; onAccept: (invitationId: string, type: 'admin' | 'member') => void; onReject: (invitationId: string, type: 'admin' | 'member') => void; processing?: boolean }

export function InvitationCard({ invitation, onAccept, onReject, processing }: InvitationCardProps) {
  return (
    <div className={styles.invitation}>
      <div className={styles.invitationMain}>
        <p className={styles.invitationTitle}>{invitation.teamName} 邀请你成为{invitation.type === 'member' ? '成员' : '管理员'}</p>
        <p className={styles.invitationMeta}>{invitation.ownerName ? `邀请人：${invitation.ownerName}` : '团队邀请'}{invitation.schoolName ? ` · ${invitation.schoolName}` : ''}</p>
      </div>
      <div className={styles.invitationActions}>
        <Button size="sm" variant="secondary" onClick={() => onReject(invitation.id, invitation.type)} disabled={processing}>拒绝</Button>
        <Button size="sm" onClick={() => onAccept(invitation.id, invitation.type)} loading={processing}>接受</Button>
      </div>
    </div>
  )
}
