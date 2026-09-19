'use client'

import { ProfileEditor } from '@/features/auth'
import unifiedStyles from './page.unified.module.css'

export default function AdminProfilePage() {
  return (
    <>
      <div className={unifiedStyles.u1}>
        <h2 className={unifiedStyles.u2}>
          个人信息
        </h2>
        <ProfileEditor />
      </div>
    </>
  )
}
