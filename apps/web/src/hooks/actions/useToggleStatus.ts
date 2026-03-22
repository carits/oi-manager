'use client'

import { useState } from 'react'
import { getAuthHeaders } from '@/lib/auth'
import { ENV } from '@/config/env'

export interface UseToggleStatusResult {
  toggleStatus: (id: string, newStatus: 'active' | 'disabled') => Promise<boolean>
  toggling: boolean
}

export function useToggleStatus(endpoint: string, onSuccess?: () => void): UseToggleStatusResult {
  const [toggling, setToggling] = useState(false)

  const toggleStatus = async (id: string, newStatus: 'active' | 'disabled'): Promise<boolean> => {
    setToggling(true)
    try {
      const res = await fetch(`${ENV.API_URL}${endpoint}/${id}/status`, {
        method: 'PUT',
        headers: {
          ...getAuthHeaders(),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ status: newStatus })
      })
      const data = await res.json()
      if (data.success) {
        onSuccess?.()
        return true
      } else {
        alert(data.message || '操作失败')
        return false
      }
    } catch (error) {
      console.error('Toggle status error:', error)
      alert('操作失败')
      return false
    } finally {
      setToggling(false)
    }
  }

  return { toggleStatus, toggling }
}
