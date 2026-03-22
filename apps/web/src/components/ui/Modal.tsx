'use client'

import React, { useEffect } from 'react'
import { modalStyles } from '@/lib/styles'

export interface ModalProps {
  isOpen: boolean
  onClose: () => void
  title?: string
  children: React.ReactNode
  footer?: React.ReactNode
  width?: string
}

export function Modal({ isOpen, onClose, title, children, footer, width = '600px' }: ModalProps) {
  // ESC 键关闭
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    if (isOpen) {
      document.addEventListener('keydown', handleEsc)
      document.body.style.overflow = 'hidden'
    }
    return () => {
      document.removeEventListener('keydown', handleEsc)
      document.body.style.overflow = 'unset'
    }
  }, [isOpen, onClose])

  if (!isOpen) return null

  return (
    <div style={modalStyles.overlay} onClick={onClose}>
      <div
        style={{ ...modalStyles.content, maxWidth: width }}
        onClick={(e) => e.stopPropagation()}
      >
        {title && (
          <div style={modalStyles.header}>
            <h3 style={modalStyles.title}>{title}</h3>
            <button onClick={onClose} style={modalStyles.closeButton}>
              ×
            </button>
          </div>
        )}
        <div>{children}</div>
        {footer && <div style={modalStyles.footer}>{footer}</div>}
      </div>
    </div>
  )
}
