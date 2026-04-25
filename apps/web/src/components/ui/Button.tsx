import React from 'react'
import { buttonStyles } from '@/lib/styles'

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger' | 'text'
  size?: 'sm' | 'md' | 'lg'
  loading?: boolean
  icon?: React.ReactNode
  fullWidth?: boolean
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading,
  icon,
  fullWidth,
  children,
  disabled,
  style,
  ...props
}: ButtonProps) {
  const sizeStyles: Record<string, React.CSSProperties> = {
    sm: { padding: '0.25rem 0.625rem', fontSize: '0.8125rem', borderRadius: 'var(--radius-sm)' },
    md: {},
    lg: { padding: '0.625rem 1.25rem', fontSize: '1rem' },
  }

  const variantStyle = buttonStyles[variant] || buttonStyles.primary

  const combinedStyles: React.CSSProperties = {
    ...buttonStyles.base,
    ...variantStyle,
    ...sizeStyles[size],
    ...(disabled || loading ? buttonStyles.disabled : {}),
    ...(fullWidth ? { width: '100%' } : {}),
    ...style,
  }

  return (
    <button
      style={combinedStyles}
      disabled={disabled || loading}
      {...props}
    >
      {loading && <span style={{ display: 'inline-block', width: '1em', height: '1em', border: '2px solid currentColor', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.6s linear infinite', marginRight: '0.375rem' }} />}
      {icon && !loading && <span style={{ display: 'flex', alignItems: 'center' }}>{icon}</span>}
      {children}
    </button>
  )
}
