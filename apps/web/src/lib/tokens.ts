// 设计 token — 与 globals.css 中的 CSS 变量一一对应
// 供内联样式使用，确保 JS 样式和 CSS 变量一致

export const colors = {
  primary: 'var(--primary)',
  primaryHover: 'var(--primary-hover)',
  primaryLight: 'var(--primary-light)',
  primaryText: 'var(--primary-text)',
  success: 'var(--success)',
  successLight: 'var(--success-light)',
  successText: 'var(--success-text)',
  warning: 'var(--warning)',
  warningLight: 'var(--warning-light)',
  warningText: 'var(--warning-text)',
  error: 'var(--error)',
  errorLight: 'var(--error-light)',
  errorText: 'var(--error-text)',
  info: 'var(--info)',
  infoLight: 'var(--info-light)',
  infoText: 'var(--info-text)',
  bgPage: 'var(--bg-page)',
  bgCard: 'var(--bg-card)',
  bgHover: 'var(--bg-hover)',
  bgMuted: 'var(--bg-muted)',
  textPrimary: 'var(--text-primary)',
  textSecondary: 'var(--text-secondary)',
  textMuted: 'var(--text-muted)',
  textInverse: 'var(--text-inverse)',
  border: 'var(--border)',
  borderHover: 'var(--border-hover)',
} as const

export const radius = {
  sm: 'var(--radius-sm)',
  default: 'var(--radius)',
  md: 'var(--radius-md)',
  lg: 'var(--radius-lg)',
  full: 'var(--radius-full)',
} as const

export const shadow = {
  xs: 'var(--shadow-xs)',
  sm: 'var(--shadow-sm)',
  default: 'var(--shadow)',
  md: 'var(--shadow-md)',
  lg: 'var(--shadow-lg)',
} as const

export const space = {
  1: 'var(--space-1)',
  2: 'var(--space-2)',
  3: 'var(--space-3)',
  4: 'var(--space-4)',
  5: 'var(--space-5)',
  6: 'var(--space-6)',
  8: 'var(--space-8)',
  10: 'var(--space-10)',
} as const

export const fontSize = {
  xs: 'var(--text-xs)',
  sm: 'var(--text-sm)',
  base: 'var(--text-base)',
  lg: 'var(--text-lg)',
  xl: 'var(--text-xl)',
  '2xl': 'var(--text-2xl)',
} as const
