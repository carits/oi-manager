import React from 'react'
import { emptyStyles } from '@/lib/styles'

export interface EmptyProps {
  text?: string
  icon?: React.ReactNode
}

export function Empty({ text = '暂无数据', icon }: EmptyProps) {
  return (
    <div style={emptyStyles.container}>
      {icon && <div style={emptyStyles.icon}>{icon}</div>}
      <div style={emptyStyles.text}>{text}</div>
    </div>
  )
}
