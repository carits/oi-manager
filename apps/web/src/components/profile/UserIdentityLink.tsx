'use client'

import type { CSSProperties } from 'react'
import Link from 'next/link'
import { useAuth } from '@/components/AuthProvider'
import { getAssetUrl } from '@/lib/assets'

export type ProfileUserType = 'teacher' | 'student' | 'user'

interface UserIdentityLinkProps {
  id?: string | null
  userType?: ProfileUserType | string | null
  name?: string | null
  username?: string | null
  avatar?: string | null
  avatarOnly?: boolean
  showUsername?: boolean
  currentSuffix?: string
  size?: number
  style?: CSSProperties
}

function normalizeUserType(userType?: string | null, personalMode?: boolean): ProfileUserType | null {
  if (personalMode || userType === 'user') return 'user'
  if (userType === 'teacher' || userType === 'student') return userType
  return null
}

function profileHref(id: string, userType: ProfileUserType): string {
  return '/profile/' + userType + '/' + id
}

function displayName(name?: string | null, username?: string | null, personalMode?: boolean): string {
  if (personalMode) return username || name || '用户'
  return name || username || '用户'
}

export function UserIdentityLink({
  id,
  userType,
  name,
  username,
  avatar,
  avatarOnly = false,
  showUsername = false,
  currentSuffix,
  size = 40,
  style,
}: UserIdentityLinkProps) {
  const { user } = useAuth()
  const personalMode = user?.workspaceMode === 'personal' || user?.studentMode === 'personal'
  const normalizedType = normalizeUserType(userType, personalMode)
  const label = displayName(name, username, personalMode)
  const href = id && normalizedType ? profileHref(id, normalizedType) : null
  const content = avatarOnly ? (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: avatar ? 'url(' + getAssetUrl(avatar) + ') center/cover' : 'var(--primary)',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'white',
        fontWeight: 600,
        fontSize: Math.max(12, Math.round(size * 0.4)),
        flexShrink: 0,
        textDecoration: 'none',
        ...style,
      }}
      aria-label={label}
    >
      {!avatar && label.charAt(0).toUpperCase()}
    </span>
  ) : (
    <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: '0.35rem', minWidth: 0, ...style }}>
      <span style={{ fontWeight: 500 }}>{label}{currentSuffix || ''}</span>
      {showUsername && username && username !== label && (
        <span style={{ color: 'var(--text-muted)', fontSize: '0.875em' }}>({username})</span>
      )}
    </span>
  )

  if (!href) return content

  return (
    <Link href={href} onClick={(event) => event.stopPropagation()} style={{ color: 'var(--primary)', textDecoration: 'none' }}>
      {content}
    </Link>
  )
}
