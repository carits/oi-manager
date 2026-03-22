import React from 'react'
import { buttonStyles } from '@/lib/styles'

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'text'
  size?: 'sm' | 'md' | 'lg'
  loading?: boolean
  icon?: React.ReactNode
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading,
  icon,
  children,
  disabled,
  style,
  ...props
}: ButtonProps) {
  const sizeStyles = {
    sm: { padding: '0.25rem 0.5rem', fontSize: '0.75rem' },
    md: {},
    lg: { padding: '0.75rem 1.5rem', fontSize: '1rem' }
  }

  const combinedStyles = {
    ...buttonStyles.base,
    ...buttonStyles[variant],
    ...sizeStyles[size],
    ...(disabled || loading ? buttonStyles.disabled : {}),
    ...style
  }

  return (
    <button
      style={combinedStyles}
      disabled={disabled || loading}
      {...props}
    >
      {loading && <span>...</span>}
      {icon && !loading && icon}
      {children}
    </button>
  )
}
