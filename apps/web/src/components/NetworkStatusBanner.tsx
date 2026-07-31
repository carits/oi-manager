'use client'

import { useEffect, useState } from 'react'

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
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 1000,
        padding: '0.4rem 1rem',
        textAlign: 'center',
        background: 'var(--warning-light)',
        color: 'var(--warning-text)',
        borderBottom: '1px solid var(--warning)',
        fontSize: '0.8rem',
      }}
    >
      网络连接已断开，当前内容会保留，恢复后将自动刷新
    </div>
  )
}
