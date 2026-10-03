'use client'

import { useState } from 'react'
import { apiClient } from '@/lib/apiClient'
import { useToast } from '@/components/ui/Toast'

export interface UseToggleStatusResult {
  toggleStatus: (id: string, newStatus: 'active' | 'disabled') => Promise<boolean>
  toggling: boolean
}

export function useToggleStatus(endpoint: string, onSuccess?: () => void): UseToggleStatusResult {
  const [toggling, setToggling] = useState(false)
  const toast = useToast()

  const toggleStatus = async (id: string, newStatus: 'active' | 'disabled'): Promise<boolean> => {
    setToggling(true)
    try {
      const res = await apiClient.put(`${endpoint}/${id}/status`, { status: newStatus })
      if (res.success) {
        onSuccess?.()
        return true
      } else {
        console.error('Toggle status response:', res); toast.error('操作失败')
        return false
      }
    } catch (error) {
      console.error('Toggle status error:', error)
      toast.error('操作失败')
      return false
    } finally {
      setToggling(false)
    }
  }

  return { toggleStatus, toggling }
}
