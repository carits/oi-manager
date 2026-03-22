'use client'

import Link from 'next/link'
import { getAssetUrl } from '@/lib/assets'

export interface TeamCardProps {
  id: string
  name: string
  avatar?: string | null
  description?: string | null
  memberCount: number
  schoolName: string
  ownerName?: string
  isPublic?: boolean
  basePath?: string // 自定义链接前缀，默认为 '/teacher/teams'
}

export function TeamCard({
  id,
  name,
  avatar,
  description,
  memberCount,
  schoolName,
  ownerName,
  isPublic,
  basePath = '/teacher/teams'
}: TeamCardProps) {
  const content = (
    <>
      {/* 头像和名称 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem' }}>
        <div
          style={{
            width: '48px',
            height: '48px',
            borderRadius: '50%',
            background: avatar ? `url(${getAssetUrl(avatar)}) center/cover` : 'var(--primary)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'white',
            fontWeight: 600,
            fontSize: '1.25rem',
            flexShrink: 0
          }}
        >
          {!avatar && name.charAt(0)}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3 style={{
            fontSize: '1rem',
            fontWeight: 600,
            margin: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap'
          }}>
            {name}
          </h3>
          <p style={{
            fontSize: '0.75rem',
            color: 'var(--gray-500)',
            margin: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap'
          }}>
            {schoolName}
          </p>
        </div>
      </div>

      {/* 描述 */}
      {description && (
        <p style={{
          fontSize: '0.875rem',
          color: 'var(--gray-600)',
          margin: '0 0 0.75rem 0',
          lineHeight: 1.5,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical'
        }}>
          {description}
        </p>
      )}

      {/* 标签 */}
      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.25rem',
          padding: '0.25rem 0.5rem',
          borderRadius: '4px',
          fontSize: '0.75rem',
          background: 'var(--gray-50)',
          color: 'var(--gray-600)'
        }}>
          👤 {memberCount} 人
        </span>
        {ownerName && (
          <span style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.25rem',
            padding: '0.25rem 0.5rem',
            borderRadius: '4px',
            fontSize: '0.75rem',
            background: 'var(--primary-light)',
            color: 'var(--primary)'
          }}>
            👑 {ownerName}
          </span>
        )}
        {isPublic === false && (
          <span style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.25rem',
            padding: '0.25rem 0.5rem',
            borderRadius: '4px',
            fontSize: '0.75rem',
            background: '#fef3c7',
            color: '#92400e'
          }}>
            🔒 私有
          </span>
        )}
      </div>
    </>
  )

  return (
    <Link
      href={`${basePath}/${id}`}
      style={{
        display: 'block',
        background: 'white',
        borderRadius: '12px',
        border: '1px solid var(--border)',
        padding: '1.25rem',
        textDecoration: 'none',
        color: 'inherit',
        transition: 'all 0.2s',
        height: '100%'
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)'
        e.currentTarget.style.transform = 'translateY(-2px)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.boxShadow = 'none'
        e.currentTarget.style.transform = 'translateY(0)'
      }}
    >
      {content}
    </Link>
  )
}