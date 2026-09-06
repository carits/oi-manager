'use client'
import { cloneElement, createContext, isValidElement, useContext, useEffect, useId, useRef, useState, type ReactElement, type ReactNode } from 'react'
import { Button, type ButtonProps } from './Button'
import styles from './primitives.module.css'

const PopoverCloseContext = createContext<() => void>(() => {})

export function IconButton({ 'aria-label': label, ...props }: Omit<ButtonProps, 'iconOnly'> & { 'aria-label': string }) {
  return <Button {...props} aria-label={label} iconOnly />
}

export function Popover({ trigger, children, align = 'start', side = 'bottom', label = '弹出内容' }: { trigger: ReactElement; children: ReactNode; align?: 'start' | 'end'; side?: 'top' | 'bottom'; label?: string }) {
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
  return <div className={styles.popover} ref={rootRef}>{control}{open && <div id={panelId} className={styles.popoverPanel} data-align={align} data-side={side} aria-label={label}><PopoverCloseContext.Provider value={() => setOpen(false)}>{children}</PopoverCloseContext.Provider></div>}</div>
}

export function Menu({ trigger, items, side = 'bottom', label = '操作菜单' }: { trigger: ReactElement; label?: string; side?: 'top' | 'bottom'; items: Array<{ key: string; label: string; icon?: ReactNode; danger?: boolean; disabled?: boolean; onSelect: () => void }> }) {
  return <Popover trigger={trigger} align="end" side={side} label={label}><MenuItems items={items} /></Popover>
}

function MenuItems({ items }: { items: Array<{ key: string; label: string; icon?: ReactNode; danger?: boolean; disabled?: boolean; onSelect: () => void }> }) {
  const close = useContext(PopoverCloseContext)
  return <div className={styles.menuList} role="menu">{items.map(item => <button key={item.key} type="button" role="menuitem" disabled={item.disabled} data-danger={item.danger || undefined} onClick={() => { item.onSelect(); close() }}>{item.icon}<span>{item.label}</span></button>)}</div>
}
