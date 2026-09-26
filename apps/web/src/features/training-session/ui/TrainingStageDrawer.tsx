'use client'

import { useEffect, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import styles from './TrainingEngine.module.css'

type Props = {
  isOpen: boolean
  title: string
  description?: string
  onClose: () => void
  children: ReactNode
}

export function TrainingStageDrawer({ isOpen, title, description, onClose, children }: Props) {
  const drawerRef = useRef<HTMLElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!isOpen) return
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    drawerRef.current?.querySelector<HTMLButtonElement>('button')?.focus()
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', handleKeyDown)
      previousFocusRef.current?.focus()
    }
  }, [isOpen, onClose])

  if (!isOpen) return null

  return <div className={styles.stageDrawerLayer}>
    <button className={styles.stageDrawerBackdrop} aria-label="关闭阶段设置" onClick={onClose} />
    <aside ref={drawerRef} className={styles.stageDrawer} role="dialog" aria-modal="true" aria-labelledby="training-stage-drawer-title">
      <header className={styles.stageDrawerHeader}>
        <div>
          <h2 id="training-stage-drawer-title">{title}</h2>
          {description && <p>{description}</p>}
        </div>
        <Button iconOnly variant="ghost" aria-label="关闭阶段设置" title="关闭阶段设置" onClick={onClose}>
          <X size={18} />
        </Button>
      </header>
      <div className={styles.stageDrawerBody}>{children}</div>
    </aside>
  </div>
}
