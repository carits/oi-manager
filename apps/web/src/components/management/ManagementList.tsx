'use client'

import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { getAssetUrl } from '@/lib/assets'
import styles from './ManagementList.module.css'

const ActionMenuContext = createContext<() => void>(() => {})

export function ManagementToolbar({ children, total, noun }: { children: ReactNode; total: number; noun: string }) {
  return <div className={styles.toolbar}>{children}<span className={styles.count}>共 {total} 名{noun}</span></div>
}

export function IdentityCell({ name, username, avatar }: { name: string; username?: string; avatar?: string | null }) {
  return <div className={styles.identity}>{avatar ? <img className={styles.avatar} src={getAssetUrl(avatar)} alt="" /> : <span className={styles.avatarFallback}>{name.charAt(0) || '?'}</span>}<span className={styles.identityText}><span className={styles.identityName}>{name}</span>{username && <span className={styles.identityUsername}>{username}</span>}</span></div>
}

export function ActionMenu({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const close = (event: MouseEvent) => { if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false) }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', close); document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', escape) }
  }, [])
  return <div className={`${styles.actionMenu} ${open ? styles.actionMenuOpen : ''}`} ref={rootRef}><Button variant="ghost" size="sm" className={styles.moreButton} icon={<ChevronDown size={14} aria-hidden="true" />} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(value => !value)}>更多</Button>{open && <ActionMenuContext.Provider value={() => setOpen(false)}><div className={styles.actionPanel} role="menu">{children}</div></ActionMenuContext.Provider>}</div>
}

export function ActionMenuItem({ children, danger, onClick }: { children: ReactNode; danger?: boolean; onClick: () => void }) {
  const close = useContext(ActionMenuContext)
  return <button type="button" role="menuitem" className={`${styles.actionItem} ${danger ? styles.actionDanger : ''}`} onClick={() => { close(); onClick() }}>{children}</button>
}

export { styles as managementListStyles }
