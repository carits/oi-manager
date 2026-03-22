'use client'

import { useState } from 'react'
import { getAuthHeaders } from '@/lib/auth'
import { ENV } from '@/config/env'

export interface UseDeleteResult {
  deleteItem: (id: string, confirmMessage?: string) => Promise<boolean>
  deleting: boolean
}

export function useDelete(endpoint: string, onSuccess?: () => void): UseDeleteResult {
  const [deleting, setDeleting] = useState(false)

  const deleteItem = async (id: string, confirmMessage?: string): Promise<boolean> => {
    if (confirmMessage && !confirm(confirmMessage)) {
      return false
    }

    setDeleting(true)
    try {
      const res = await fetch(`${ENV.API_URL}${endpoint}/${id}`, {
        method: 'DELETE',
        headers: getAuthHeaders()
      })
      const data = await res.json()
      if (data.success) {
        onSuccess?.()
        return true
      } else {
        alert(data.message || '删除失败')
        return false
      }
    } catch (error) {
      console.error('Delete error:', error)
      alert('删除失败')
      return false
    } finally {
      setDeleting(false)
    }
  }

  return { deleteItem, deleting }
}
