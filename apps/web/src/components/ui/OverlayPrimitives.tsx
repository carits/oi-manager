'use client'
import { cloneElement, isValidElement, useEffect, useId, useRef, useState, type ReactElement, type ReactNode } from 'react'
import { Button, type ButtonProps } from './Button'
import styles from './primitives.module.css'

export function IconButton({ 'aria-label': label, ...props }: Omit<ButtonProps, 'iconOnly'> & { 'aria-label': string }) {
  return <Button {...props} aria-label={label} iconOnly />
}

export function Popover({ trigger, children, align = 'start', label = '弹出内容' }: { trigger: ReactElement; children: ReactNode; align?: 'start' | 'end'; label?: string }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const panelId = useId()
  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false) }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', escape) }
  }, [open])
  const control = isValidElement<any>(trigger) ? cloneElement(trigger, { 'aria-expanded': open, 'aria-controls': panelId, 'aria-haspopup': true, onClick: (event: React.MouseEvent) => { trigger.props.onClick?.(event); setOpen(current => !current) } }) : trigger
  return <div className={styles.popover} ref={rootRef}>{control}{open && <div id={panelId} className={styles.popoverPanel} data-align={align} aria-label={label}>{children}</div>}</div>
}

export function Menu({ trigger, items, label = '操作菜单' }: { trigger: ReactElement; label?: string; items: Array<{ key: string; label: string; icon?: ReactNode; danger?: boolean; disabled?: boolean; onSelect: () => void }> }) {
  return <Popover trigger={trigger} align="end" label={label}><div className={styles.menuList} role="menu">{items.map(item => <button key={item.key} type="button" role="menuitem" disabled={item.disabled} data-danger={item.danger || undefined} onClick={item.onSelect}>{item.icon}<span>{item.label}</span></button>)}</div></Popover>
}
