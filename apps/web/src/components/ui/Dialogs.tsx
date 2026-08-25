'use client'
import { useState, type ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Modal, type ModalSize } from './Modal'
import { Button } from './Button'
import styles from './primitives.module.css'
import { dialogCloseAction } from './dialog-contract'

interface Common { isOpen: boolean; onClose: () => void; title: string; description?: string; children: ReactNode; size?: ModalSize }
export function ConfirmDialog({ isOpen, onClose, onConfirm, title, description, message, confirmText = '确认', cancelText = '取消', danger = false, loading = false }: Omit<Common, 'children'> & { message: ReactNode; onConfirm: () => void; confirmText?: string; cancelText?: string; danger?: boolean; loading?: boolean }) {
  return <Modal isOpen={isOpen} onClose={onClose} title={title} description={description} size="sm" busy={loading} closeOnOverlay={!loading} footer={<><Button variant="secondary" onClick={onClose} disabled={loading}>{cancelText}</Button><Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} loading={loading}>{confirmText}</Button></>}><div className={danger ? styles.dialogWarning : styles.dialogMessage}>{danger && <AlertTriangle size={20} aria-hidden="true" />}<div>{message}</div></div></Modal>
}
export function FormDialog({ isOpen, onClose, onSubmit, title, description, children, size = 'md', submitText = '保存', cancelText = '取消', dirty = false, loading = false, danger = false, footer, closeOnOverlay }: Common & { onSubmit?: () => void; submitText?: string; cancelText?: string; dirty?: boolean; loading?: boolean; danger?: boolean; footer?: ReactNode; closeOnOverlay?: boolean }) {
  const [confirmClose, setConfirmClose] = useState(false)
  const requestClose = () => { const action = dialogCloseAction(loading, dirty); if (action === 'confirm') setConfirmClose(true); else if (action === 'close') onClose() }
  const standardFooter = onSubmit ? <><Button variant="secondary" onClick={requestClose} disabled={loading}>{cancelText}</Button><Button variant={danger ? 'danger' : 'primary'} onClick={onSubmit} loading={loading}>{submitText}</Button></> : undefined
  return <><Modal isOpen={isOpen} onClose={requestClose} title={title} description={description} size={size} busy={loading} closeOnOverlay={closeOnOverlay ?? (!dirty && !loading)} footer={footer ?? standardFooter}>{children}</Modal><ConfirmDialog isOpen={confirmClose} onClose={() => setConfirmClose(false)} onConfirm={() => { setConfirmClose(false); onClose() }} title="放弃未保存的修改？" message="关闭后，本次修改将不会保存。" confirmText="放弃修改" danger /></>
}
export function DetailDialog({ isOpen, onClose, title, description, children, size = 'xl', footer }: Common & { footer?: ReactNode; scrollMode?: 'content' | 'page' }) {
  return <Modal isOpen={isOpen} onClose={onClose} title={title} description={description} size={size} scrollMode="page" footer={footer}>{children}</Modal>
}
