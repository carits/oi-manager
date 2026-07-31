'use client'

import { PasswordEditor } from '@/components/profile'

export default function StudentSecurityPage() {
  return (
    <>
      <div style={{ padding: '1rem 0' }}>
        <h2 style={{ fontSize: '1.5rem', fontWeight: 600, marginBottom: '1.5rem' }}>
          账号安全
        </h2>
        <PasswordEditor />
      </div>
    </>
  )
}