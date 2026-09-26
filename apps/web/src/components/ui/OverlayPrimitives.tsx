'use client'
import { cloneElement, createContext, isValidElement, useContext, useEffect, useId, useRef, useState, type ReactElement, type ReactNode } from 'react'
import { Button, type ButtonProps } from './Button'
import styles from './primitives.module.css'

const PopoverCloseContext = createContext<() => void>(() => {})

export function usePopoverClose() {
  return useContext(PopoverCloseContext)
}

export function IconButton({ 'aria-label': label, ...props }: Omit<ButtonProps, 'iconOnly'> & { 'aria-label': string }) {
  return <Button {...props} aria-label={label} iconOnly />
}

export function Popover({ trigger, children, align = 'start', side = 'bottom', label = '弹出内容' }: { trigger: ReactElement; children: ReactNode; align?: 'start' | 'end'; side?: 'top' | 'bottom'; label?: string }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLElement | null>(null)
  const panelId = useId()
  useEffect(() => {
    if (!open) return
    const focusFrame = window.requestAnimationFrame(() => {
      panelRef.current?.querySelector<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')?.focus()
    })
    const close = (event: MouseEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false) }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setOpen(false); triggerRef.current?.focus() } }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', escape)
    return () => { window.cancelAnimationFrame(focusFrame); document.removeEventListener('mousedown', close); document.removeEventListener('keydown', escape) }
  }, [open])
  const control = isValidElement<any>(trigger) ? cloneElement(trigger, { 'aria-expanded': open, 'aria-controls': panelId, 'aria-haspopup': true, onClick: (event: React.MouseEvent<HTMLElement>) => { triggerRef.current = event.currentTarget; trigger.props.onClick?.(event); setOpen(current => !current) } }) : trigger
  return <div className={styles.popover} ref={rootRef}>{control}{open && <div ref={panelRef} id={panelId} className={styles.popoverPanel} data-align={align} data-side={side} aria-label={label}><PopoverCloseContext.Provider value={() => { setOpen(false); triggerRef.current?.focus() }}>{children}</PopoverCloseContext.Provider></div>}</div>
}

export function Menu({ trigger, items, side = 'bottom', label = '操作菜单' }: { trigger: ReactElement; label?: string; side?: 'top' | 'bottom'; items: Array<{ key: string; label: string; icon?: ReactNode; danger?: boolean; disabled?: boolean; onSelect: () => void }> }) {
  return <Popover trigger={trigger} align="end" side={side} label={label}><MenuItems items={items} /></Popover>
}

function MenuItems({ items }: { items: Array<{ key: string; label: string; icon?: ReactNode; danger?: boolean; disabled?: boolean; onSelect: () => void }> }) {
  const close = useContext(PopoverCloseContext)
  const listRef = useRef<HTMLDivElement>(null)
  const firstEnabledIndex = items.findIndex(item => !item.disabled)
  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    const buttons = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>('button:not([disabled])') || [])
    if (!buttons.length) return
    event.preventDefault()
    const currentIndex = buttons.indexOf(document.activeElement as HTMLButtonElement)
    const next = event.key === 'Home' ? 0
      : event.key === 'End' ? buttons.length - 1
        : event.key === 'ArrowDown' ? (currentIndex + 1 + buttons.length) % buttons.length
          : (currentIndex - 1 + buttons.length) % buttons.length
    buttons[next]?.focus()
  }
  return <div ref={listRef} className={styles.menuList} role="menu" onKeyDown={handleKeyDown}>{items.map((item, index) => <button key={item.key} type="button" role="menuitem" tabIndex={index === firstEnabledIndex ? 0 : -1} disabled={item.disabled} data-danger={item.danger || undefined} onClick={() => { item.onSelect(); close() }}>{item.icon}<span>{item.label}</span></button>)}</div>
}
