'use client'

import type { ReactNode } from 'react'
import { Modal, type ModalSize } from './Modal'

/** A layout variant of the shared dialog, not a second overlay/focus implementation. */
export function Drawer({ isOpen, title, description, onClose, children, busy = false, size = 'lg', closeLabel = '关闭详情' }: {
  isOpen: boolean
  title: string
  description?: string
  onClose: () => void
  children: ReactNode
  busy?: boolean
  size?: ModalSize
  closeLabel?: string
}) {
  return <Modal isOpen={isOpen} onClose={onClose} title={title} description={description} size={size} busy={busy} closeOnOverlay={!busy} scrollMode="page" placement="right" closeLabel={closeLabel}>{children}</Modal>
}
