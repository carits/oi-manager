'use client'

import { useState } from 'react'

export interface UseModalResult<T> {
  isOpen: boolean
  data: T | null
  open: (initialData?: T) => void
  close: () => void
}

export function useModal<T = any>(): UseModalResult<T> {
  const [isOpen, setIsOpen] = useState(false)
  const [data, setData] = useState<T | null>(null)

  const open = (initialData?: T) => {
    setData(initialData || null)
    setIsOpen(true)
  }

  const close = () => {
    setIsOpen(false)
    setData(null)
  }

  return { isOpen, data, open, close }
}
