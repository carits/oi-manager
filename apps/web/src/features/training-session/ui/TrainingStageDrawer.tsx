'use client'

import type { ReactNode } from 'react'
import { Drawer } from '@/components/ui/Drawer'

type Props = { isOpen: boolean; title: string; description?: string; onClose: () => void; children: ReactNode }

export function TrainingStageDrawer({ isOpen, title, description, onClose, children }: Props) {
  return <Drawer isOpen={isOpen} title={title} description={description} onClose={onClose} size="xl" closeLabel="关闭阶段设置">{children}</Drawer>
}
