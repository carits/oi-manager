'use client'

import type { CSSProperties } from 'react'
import type { ProfileUserType } from '@oi-manager/contracts'
import unifiedStyles from './UserIdentityLink.unified.module.css'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { getAssetUrl } from '@/lib/assets'
import { isPersonalPath } from '@/lib/workspacePath'

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
  className?: string
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
  className,
}: UserIdentityLinkProps) {
  const pathname = usePathname()
  const personalMode = isPersonalPath(pathname)
  const normalizedType = normalizeUserType(userType, personalMode)
  const label = displayName(name, username, personalMode)
  const href = id && normalizedType ? profileHref(id, normalizedType) : null
  const avatarStyle = {
    '--identity-size': `${size}px`,
    '--identity-avatar': avatar ? `url(${getAssetUrl(avatar)})` : 'none',
    '--identity-font-size': `${Math.max(12, Math.round(size * 0.4))}px`,
    ...style,
  } as CSSProperties
  const content = avatarOnly ? (
    <span
      className={[unifiedStyles.avatar, className].filter(Boolean).join(' ')}
      style={avatarStyle}
      aria-label={label}
    >
      {!avatar && label.charAt(0).toUpperCase()}
    </span>
  ) : (
    <span className={[unifiedStyles.identity, className].filter(Boolean).join(' ')} style={style}>
      <span className={unifiedStyles.u1}>{label}{currentSuffix || ''}</span>
      {showUsername && username && username !== label && (
        <span className={unifiedStyles.u2}>({username})</span>
      )}
    </span>
  )

  if (!href) return content

  return (
    <Link href={href} onClick={(event) => event.stopPropagation()} className={`${unifiedStyles.u3} ${className || ''}`.trim()}>
      {content}
    </Link>
  )
}
