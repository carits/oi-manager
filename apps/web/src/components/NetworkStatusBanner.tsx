'use client'

import { useEffect, useState } from 'react'
import unifiedStyles from './NetworkStatusBanner.unified.module.css'

export function NetworkStatusBanner() {
  const [online, setOnline] = useState(true)

  useEffect(() => {
    const update = () => setOnline(navigator.onLine)
    update()
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }, [])

  if (online) return null

  return (
    <div
      role="status"
      className={unifiedStyles.u1}
    >
      网络连接已断开，当前内容会保留，恢复后将自动刷新
    </div>
  )
}
