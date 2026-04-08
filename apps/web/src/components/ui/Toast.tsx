'use client'

import React, { createContext, useContext, useState, useCallback, useRef } from 'react'

// ==================== 类型定义 ====================

type ToastType = 'success' | 'error' | 'warning' | 'info'

interface ToastItem {
  id: number
  type: ToastType
  message: string
}

interface ToastContextValue {
  toast: (type: ToastType, message: string) => void
  success: (message: string) => void
  error: (message: string) => void
  warning: (message: string) => void
  info: (message: string) => void
}

// ==================== 上下文 ====================

const ToastContext = createContext<ToastContextValue | null>(null)

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return ctx
}

// ==================== 颜色配置 ====================

const typeConfig: Record<ToastType, { bg: string; border: string; icon: string }> = {
  success: { bg: '#f0fdf4', border: '#86efac', icon: '✓' },
  error:   { bg: '#fef2f2', border: '#fca5a5', icon: '✕' },
  warning: { bg: '#fffbeb', border: '#fcd34d', icon: '!' },
  info:    { bg: '#eff6ff', border: '#93c5fd', icon: 'i' },
}

// ==================== ToastItem 组件 ====================

function ToastItemView({ item, onRemove }: { item: ToastItem; onRemove: (id: number) => void }) {
  const config = typeConfig[item.type]

  useState(() => {
    const timer = setTimeout(() => onRemove(item.id), 3500)
    return () => clearTimeout(timer)
  })

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.625rem',
        padding: '0.75rem 1rem',
        background: config.bg,
        border: `1px solid ${config.border}`,
        borderRadius: '8px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
        minWidth: '280px',
        maxWidth: '420px',
        animation: 'toast-in 0.25s ease-out',
      }}
    >
      <span style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '20px',
        height: '20px',
        borderRadius: '50%',
        fontSize: '0.7rem',
        fontWeight: 700,
        color: '#fff',
        background: item.type === 'success' ? '#22c55e'
          : item.type === 'error' ? '#ef4444'
          : item.type === 'warning' ? '#f59e0b'
          : '#3b82f6',
        flexShrink: 0,
      }}>
        {config.icon}
      </span>
      <span style={{ fontSize: '0.875rem', color: '#374151', flex: 1, lineHeight: 1.4 }}>
        {item.message}
      </span>
      <button
        onClick={() => onRemove(item.id)}
        style={{
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          fontSize: '1rem',
          color: '#9ca3af',
          padding: '0 0.125rem',
          lineHeight: 1,
          flexShrink: 0,
        }}
      >
        ×
      </button>
    </div>
  )
}

// ==================== ToastProvider ====================

// ==================== 非 React 上下文中的 Toast ====================

export function showToastNotification(message: string, type: ToastType = 'info') {
  const id = Date.now()
  const config = typeConfig[type]

  const el = document.createElement('div')
  el.setAttribute('data-toast-id', String(id))
  el.style.cssText = 'display:flex;align-items:center;gap:0.625rem;padding:0.75rem 1rem;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,0.08);min-width:280px;max-width:420px;background:' + config.bg + ';border:1px solid ' + config.border + ';animation:toast-in 0.25s ease-out;'

  const icon = document.createElement('span')
  icon.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:50%;font-size:0.7rem;font-weight:700;color:#fff;flex-shrink:0;background:' + (type === 'success' ? '#22c55e' : type === 'error' ? '#ef4444' : type === 'warning' ? '#f59e0b' : '#3b82f6')
  icon.textContent = config.icon

  const text = document.createElement('span')
  text.style.cssText = 'font-size:0.875rem;color:#374151;flex:1;line-height:1.4'
  text.textContent = message

  el.appendChild(icon)
  el.appendChild(text)
  document.getElementById('toast-root')?.appendChild(el)

  setTimeout(() => {
    el.style.opacity = '0'
    el.style.transition = 'opacity 0.3s'
    setTimeout(() => el.remove(), 300)
  }, 3500)
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const nextId = useRef(0)

  const remove = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  const add = useCallback((type: ToastType, message: string) => {
    const id = ++nextId.current
    setToasts(prev => [...prev, { id, type, message }])
  }, [])

  const value: ToastContextValue = {
    toast: add,
    success: (msg) => add('success', msg),
    error: (msg) => add('error', msg),
    warning: (msg) => add('warning', msg),
    info: (msg) => add('info', msg),
  }

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/* Toast 容器 */}
      {toasts.length > 0 && (
        <div style={{
          position: 'fixed',
          top: '1rem',
          right: '1rem',
          zIndex: 9999,
          display: 'flex',
          flexDirection: 'column',
          gap: '0.5rem',
          pointerEvents: 'none',
        }}>
          {toasts.map(t => (
            <div key={t.id} style={{ pointerEvents: 'auto' }}>
              <ToastItemView item={t} onRemove={remove} />
            </div>
          ))}
        </div>
      )}
      {/* 入场动画 */}
      <style>{`
        @keyframes toast-in {
          from { opacity: 0; transform: translateX(20px); }
          to   { opacity: 1; transform: translateX(0); }
        }
      `}</style>
    </ToastContext.Provider>
  )
}
