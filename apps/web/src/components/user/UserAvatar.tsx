'use client'

import { useEffect, useState } from 'react'
import { getAssetUrl } from '@/lib/assets'
import styles from './UserAvatar.module.css'

export type UserAvatarSize = 'xs' | 'sm' | 'md' | 'lg'

interface UserAvatarProps {
  avatar?: string | null
  username?: string | null
  name?: string | null
  size?: UserAvatarSize
  decorative?: boolean
  className?: string
}

function firstCharacter(value: string) {
  return Array.from(value.trim())[0]?.toUpperCase() || '?'
}

export function UserAvatar({
  avatar,
  username,
  name,
  size = 'md',
  decorative = false,
  className = '',
}: UserAvatarProps) {
  const [failed, setFailed] = useState(false)
  const label = name?.trim() || username?.trim() || '用户'
  const source = avatar && !failed ? getAssetUrl(avatar) : ''

  useEffect(() => setFailed(false), [avatar])

  return (
    <span
      className={`${styles.avatar} ${className}`.trim()}
      data-size={size}
      aria-hidden={decorative || undefined}
      aria-label={decorative ? undefined : `${label}的头像`}
    >
      {source ? <img src={source} alt="" onError={() => setFailed(true)} /> : firstCharacter(label)}
    </span>
  )
}
