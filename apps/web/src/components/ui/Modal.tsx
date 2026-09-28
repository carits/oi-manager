'use client'

import React, { useEffect, useId, useRef } from 'react'
import { X } from 'lucide-react'
import styles from './primitives.module.css'
import drawerStyles from './Drawer.module.css'
import { MODAL_SIZE_WIDTHS, type ModalSize } from './dialog-contract'
export type { ModalSize } from './dialog-contract'

export interface ModalProps {
  isOpen: boolean
  onClose: () => void
  title?: string
  children: React.ReactNode
  footer?: React.ReactNode
  description?: React.ReactNode
  size?: ModalSize
  busy?: boolean
  className?: string
  /** @deprecated Use size presets. Kept temporarily for legacy call sites. */
  width?: string
  closeOnOverlay?: boolean
  scrollMode?: 'contained' | 'page'
  placement?: 'center' | 'right'
  closeLabel?: string
}
const focusableSelector = ['a[href]', 'button:not([disabled])', 'input:not([disabled])', 'select:not([disabled])', 'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])'].join(',')

export function Modal({ isOpen, onClose, title, children, footer, description, size = 'md', busy = false, className = '', width, closeOnOverlay = true, scrollMode = 'contained', placement = 'center', closeLabel = '关闭对话框' }: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  const busyRef = useRef(busy)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const titleId = useId()
  const descriptionId = useId()
  onCloseRef.current = onClose
  busyRef.current = busy

  useEffect(() => {
    if (!isOpen) return
    returnFocusRef.current = document.activeElement as HTMLElement
    const previousBodyOverflow = document.body.style.overflow
    const previousRootOverflow = document.documentElement.style.overflow
    document.body.style.overflow = 'hidden'
    document.documentElement.style.overflow = 'hidden'
    const dialog = dialogRef.current
    const focusables = () => Array.from(dialog?.querySelectorAll<HTMLElement>(focusableSelector) || [])
      .filter(element => !element.closest('[inert]') && element.getClientRects().length > 0 && element.getAttribute('aria-hidden') !== 'true')
    const focusFrame = requestAnimationFrame(() => (focusables()[0] || dialog)?.focus())
    const handleKeyDown = (event: KeyboardEvent) => {
      const openDialogs = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]'))
      if (openDialogs.at(-1) !== dialog || event.defaultPrevented) return
      if (event.key === 'Escape') {
        event.preventDefault()
        if (!busyRef.current) onCloseRef.current()
        return
      }
      if (event.key !== 'Tab') return
      const elements = focusables()
      if (!elements.length) { event.preventDefault(); dialog?.focus(); return }
      const first = elements[0]
      const last = elements[elements.length - 1]
      if (!dialog?.contains(document.activeElement)) { event.preventDefault(); first.focus() }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      cancelAnimationFrame(focusFrame)
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = previousBodyOverflow
      document.documentElement.style.overflow = previousRootOverflow
      if (returnFocusRef.current?.isConnected) returnFocusRef.current.focus()
    }
  }, [isOpen, scrollMode])
  if (!isOpen) return null

  return <div className={`${styles.modalOverlay} ${scrollMode === 'page' ? styles.modalOverlayPage : ''} ${placement === 'right' ? drawerStyles.overlay : ''}`} data-dialog-placement={placement} onMouseDown={event => {
    if (!busy && closeOnOverlay && event.target === event.currentTarget) onClose()
  }}>
    <div ref={dialogRef} className={`${styles.modalContent} ${placement === 'right' ? drawerStyles.content : ''} ${className}`.trim()}
      style={{ '--modal-width': width || MODAL_SIZE_WIDTHS[size] } as React.CSSProperties} data-size={size} data-busy={busy || undefined}
      role="dialog" aria-modal="true" aria-labelledby={title ? titleId : undefined} aria-describedby={description ? descriptionId : undefined} aria-label={title ? undefined : '对话框'} tabIndex={-1}>
      {title && <header className={styles.modalHeader}><div>
        <h2 className={styles.modalTitle} id={titleId}>{title}</h2>
        {description && <div className={styles.modalDescription} id={descriptionId}>{description}</div>}
      </div><button type="button" className={styles.modalClose} onClick={onClose} disabled={busy} aria-label={closeLabel} title="关闭"><X size={19} aria-hidden="true" /></button></header>}
      <div className={styles.modalBody}>{children}</div>
      {footer && <footer className={styles.modalFooter}>{footer}</footer>}
    </div>
  </div>
}
