'use client'

import { PasswordEditor } from '@/components/profile'
import unifiedStyles from './page.unified.module.css'

export default function AdminSecurityPage() {
  return (
    <>
      <div className={unifiedStyles.u1}>
        <h2 className={unifiedStyles.u2}>
          账号安全
        </h2>
        <PasswordEditor />
      </div>
    </>
  )
}