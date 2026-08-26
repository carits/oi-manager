'use client'

import { createContext, type ReactNode, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
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
  const [position, setPosition] = useState({ top: 0, left: 0, placement: 'bottom' as 'top' | 'bottom' })
  const rootRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const updatePosition = () => {
    const trigger = rootRef.current
    if (!trigger) return
    const rect = trigger.getBoundingClientRect()
    const panelHeight = menuRef.current?.offsetHeight || 148
    const placement = window.innerHeight - rect.bottom < panelHeight + 12 && rect.top > panelHeight + 12 ? 'top' : 'bottom'
    setPosition({ top: placement === 'top' ? rect.top - panelHeight - 6 : rect.bottom + 6, left: Math.max(8, rect.right - 156), placement })
  }
  useLayoutEffect(() => { if (open) updatePosition() }, [open])
  useEffect(() => {
    const close = (event: MouseEvent) => { if (rootRef.current && !rootRef.current.contains(event.target as Node) && !menuRef.current?.contains(event.target as Node)) setOpen(false) }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    const reposition = () => updatePosition()
    document.addEventListener('mousedown', close); document.addEventListener('keydown', escape); window.addEventListener('resize', reposition); window.addEventListener('scroll', reposition, true)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', escape); window.removeEventListener('resize', reposition); window.removeEventListener('scroll', reposition, true) }
  }, [])
  const floatingPosition = { top: position.top, left: position.left }
  return <div className={styles.actionMenu} ref={rootRef}><Button variant="ghost" size="sm" className={styles.moreButton} icon={<ChevronDown size={14} aria-hidden="true" />} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(value => !value)}>更多</Button>{open && createPortal(<ActionMenuContext.Provider value={() => setOpen(false)}><div ref={menuRef} className={styles.actionPanel} data-placement={position.placement} style={floatingPosition} role="menu">{children}</div></ActionMenuContext.Provider>, document.body)}</div>
}

export function ActionMenuItem({ children, danger, onClick }: { children: ReactNode; danger?: boolean; onClick: () => void }) {
  const close = useContext(ActionMenuContext)
  return <Button variant="ghost" type="button" role="menuitem" className={`${styles.actionItem} ${danger ? styles.actionDanger : ''}`} onClick={() => { close(); onClick() }}>{children}</Button>
}

export { styles as managementListStyles }
