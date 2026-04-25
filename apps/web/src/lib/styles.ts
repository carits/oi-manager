// 统一样式常量 — 所有值引用 CSS 变量
// 与 globals.css :root 变量一一对应

import { CSSProperties } from 'react'

// 按钮样式
export const buttonStyles = {
  base: {
    padding: '0.5rem 1rem',
    border: 'none',
    borderRadius: 'var(--radius)',
    cursor: 'pointer',
    fontSize: '0.875rem',
    fontWeight: 500,
    transition: 'all 0.2s',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '0.5rem',
    lineHeight: 1.5,
  } as CSSProperties,
  primary: {
    background: 'var(--primary)',
    color: 'white',
  } as CSSProperties,
  secondary: {
    background: 'var(--bg-hover)',
    color: 'var(--text-secondary)',
  } as CSSProperties,
  outline: {
    background: 'transparent',
    color: 'var(--primary)',
    border: '1px solid var(--primary)',
  } as CSSProperties,
  ghost: {
    background: 'transparent',
    color: 'var(--primary)',
  } as CSSProperties,
  danger: {
    background: 'var(--error)',
    color: 'white',
  } as CSSProperties,
  text: {
    background: 'transparent',
    color: 'var(--primary)',
    padding: '0.25rem 0.5rem',
  } as CSSProperties,
  disabled: {
    opacity: 0.5,
    cursor: 'not-allowed',
  } as CSSProperties,
} as const

// 表格样式
export const tableStyles = {
  container: {
    background: 'var(--bg-card)',
    borderRadius: 'var(--radius-md)',
    border: '1px solid var(--border)',
    overflow: 'hidden',
  } as CSSProperties,
  table: {
    width: '100%',
    borderCollapse: 'collapse' as const,
  } as CSSProperties,
  thead: {
    background: 'var(--bg-muted)',
    borderBottom: '1px solid var(--border)',
  } as CSSProperties,
  th: {
    padding: '0.75rem 1rem',
    textAlign: 'left' as const,
    fontWeight: 500,
    fontSize: '0.875rem',
    color: 'var(--text-secondary)',
  } as CSSProperties,
  td: {
    padding: '0.75rem 1rem',
    fontSize: '0.875rem',
    color: 'var(--text-primary)',
    borderBottom: '1px solid var(--border)',
  } as CSSProperties,
  row: {} as CSSProperties,
} as const

// 卡片样式
export const cardStyles = {
  base: {
    background: 'var(--bg-card)',
    borderRadius: 'var(--radius-md)',
    border: '1px solid var(--border)',
    padding: '1.5rem',
  } as CSSProperties,
  hoverable: {
    background: 'var(--bg-card)',
    borderRadius: 'var(--radius-md)',
    border: '1px solid var(--border)',
    padding: '1.5rem',
    transition: 'box-shadow 0.2s, border-color 0.2s',
    cursor: 'pointer',
  } as CSSProperties,
  header: {
    marginBottom: '1rem',
    paddingBottom: '0.75rem',
    borderBottom: '1px solid var(--border)',
  } as CSSProperties,
  title: {
    fontSize: '1.125rem',
    fontWeight: 600,
    margin: 0,
    color: 'var(--text-primary)',
  } as CSSProperties,
} as const

// 模态框样式
export const modalStyles = {
  overlay: {
    position: 'fixed' as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: 'rgba(0, 0, 0, 0.4)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  } as CSSProperties,
  content: {
    background: 'var(--bg-card)',
    borderRadius: 'var(--radius-lg)',
    padding: '1.5rem',
    maxWidth: '600px',
    width: '90%',
    maxHeight: '90vh',
    overflow: 'auto',
    boxShadow: 'var(--shadow-lg)',
  } as CSSProperties,
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '1.5rem',
  } as CSSProperties,
  title: {
    fontSize: '1.125rem',
    fontWeight: 600,
    margin: 0,
    color: 'var(--text-primary)',
  } as CSSProperties,
  closeButton: {
    background: 'transparent',
    border: 'none',
    fontSize: '1.5rem',
    cursor: 'pointer',
    color: 'var(--text-muted)',
    padding: 0,
    width: '2rem',
    height: '2rem',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 'var(--radius)',
  } as CSSProperties,
  footer: {
    marginTop: '1.5rem',
    display: 'flex',
    gap: '0.5rem',
    justifyContent: 'flex-end',
  } as CSSProperties,
} as const

// 表单样式
export const formStyles = {
  field: {
    marginBottom: '1rem',
  } as CSSProperties,
  label: {
    display: 'block',
    marginBottom: '0.375rem',
    fontSize: '0.875rem',
    fontWeight: 500,
    color: 'var(--text-secondary)',
  } as CSSProperties,
  input: {
    width: '100%',
    padding: '0.5rem 0.75rem',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius)',
    fontSize: '0.875rem',
    color: 'var(--text-primary)',
    background: 'var(--bg-card)',
    boxSizing: 'border-box' as const,
    outline: 'none',
    transition: 'border-color 0.2s',
  } as CSSProperties,
  textarea: {
    width: '100%',
    padding: '0.5rem 0.75rem',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius)',
    fontSize: '0.875rem',
    color: 'var(--text-primary)',
    background: 'var(--bg-card)',
    minHeight: '100px',
    resize: 'vertical' as const,
    boxSizing: 'border-box' as const,
    outline: 'none',
    transition: 'border-color 0.2s',
  } as CSSProperties,
  select: {
    width: '100%',
    padding: '0.5rem 0.75rem',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius)',
    fontSize: '0.875rem',
    color: 'var(--text-primary)',
    background: 'var(--bg-card)',
    boxSizing: 'border-box' as const,
    outline: 'none',
    transition: 'border-color 0.2s',
  } as CSSProperties,
  error: {
    color: 'var(--error)',
    fontSize: '0.75rem',
    marginTop: '0.25rem',
  } as CSSProperties,
} as const

// 徽章样式
export const badgeStyles = {
  base: {
    padding: '2px 8px',
    borderRadius: 'var(--radius-sm)',
    fontSize: '0.75rem',
    fontWeight: 500,
    display: 'inline-block',
  } as CSSProperties,
  success: {
    background: 'var(--success-light)',
    color: 'var(--success-text)',
  } as CSSProperties,
  error: {
    background: 'var(--error-light)',
    color: 'var(--error-text)',
  } as CSSProperties,
  warning: {
    background: 'var(--warning-light)',
    color: 'var(--warning-text)',
  } as CSSProperties,
  info: {
    background: 'var(--info-light)',
    color: 'var(--info-text)',
  } as CSSProperties,
  neutral: {
    background: 'var(--bg-hover)',
    color: 'var(--text-secondary)',
  } as CSSProperties,
  pending: {
    background: 'var(--warning-light)',
    color: 'var(--warning-text)',
  } as CSSProperties,
} as const

// 页面布局样式
export const layoutStyles = {
  page: {
    minHeight: '100vh',
    background: 'var(--bg-page)',
  } as CSSProperties,
  container: {
    padding: '1.5rem 2rem',
    maxWidth: '1400px',
    margin: '0 auto',
  } as CSSProperties,
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '1.5rem',
  } as CSSProperties,
  title: {
    fontSize: '1.5rem',
    fontWeight: 600,
    margin: 0,
    color: 'var(--text-primary)',
  } as CSSProperties,
} as const

// 空状态样式
export const emptyStyles = {
  container: {
    padding: '3rem 2rem',
    textAlign: 'center' as const,
    color: 'var(--text-muted)',
  } as CSSProperties,
  icon: {
    fontSize: '3rem',
    marginBottom: '1rem',
    opacity: 0.5,
  } as CSSProperties,
  text: {
    fontSize: '0.875rem',
  } as CSSProperties,
} as const

// 加载状态样式
export const loadingStyles = {
  container: {
    padding: '2rem',
    textAlign: 'center' as const,
    color: 'var(--text-muted)',
  } as CSSProperties,
  spinner: {
    display: 'inline-block',
    width: '2rem',
    height: '2rem',
    border: '3px solid var(--border)',
    borderTopColor: 'var(--primary)',
    borderRadius: '50%',
    animation: 'spin 0.8s linear infinite',
  } as CSSProperties,
} as const
