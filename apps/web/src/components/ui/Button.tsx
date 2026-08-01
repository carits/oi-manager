import React from 'react'
import styles from './primitives.module.css'

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger' | 'text'
  size?: 'sm' | 'md' | 'lg'
  loading?: boolean
  icon?: React.ReactNode
  iconOnly?: boolean
  fullWidth?: boolean
}

const variantClasses = {
  primary: styles.buttonPrimary,
  secondary: styles.buttonSecondary,
  outline: styles.buttonOutline,
  ghost: styles.buttonGhost,
  danger: styles.buttonDanger,
  text: styles.buttonText,
} as const

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  icon,
  iconOnly = false,
  fullWidth = false,
  children,
  disabled,
  className = '',
  type = 'button',
  title,
  ...props
}: ButtonProps) {
  const accessibleLabel = props['aria-label']

  if (iconOnly && !accessibleLabel) {
    throw new Error('Icon-only buttons require an aria-label')
  }

  return (
    <button
      type={type}
      className={`${styles.button} ${variantClasses[variant]} ${iconOnly ? styles.buttonIconOnly : ''} ${className}`.trim()}
      data-size={size}
      data-full-width={fullWidth}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      title={title || (iconOnly ? accessibleLabel : undefined)}
      {...props}
    >
      {loading ? <span className={styles.spinner} aria-hidden="true" /> : icon}
      {children}
    </button>
  )
}
