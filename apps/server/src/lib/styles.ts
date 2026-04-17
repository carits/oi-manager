// 样式工具函数
// 提供常用的样式对象，减少重复的内联样式

// 使用本地类型替代 react 的 CSSProperties，避免服务器端依赖 react
type CSSProperties = Record<string, string | number>

// 按钮样式
export const buttonStyles = {
  base: {
    padding: '0.5rem 1rem',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '0.875rem',
    fontWeight: 500,
    transition: 'all 0.2s',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '0.5rem'
  } as CSSProperties,
  primary: {
    background: 'var(--primary)',
    color: 'white'
  } as CSSProperties,
  secondary: {
    background: 'var(--gray-200)',
    color: 'var(--gray-700)'
  } as CSSProperties,
  danger: {
    background: 'var(--error)',
    color: 'white'
  } as CSSProperties,
  text: {
    background: 'transparent',
    color: 'var(--primary)',
    padding: '0.25rem 0.5rem'
  } as CSSProperties,
  disabled: {
    opacity: 0.6,
    cursor: 'not-allowed'
  } as CSSProperties
}

// 表格样式
export const tableStyles = {
  container: {
    background: 'white',
    borderRadius: '8px',
    border: '1px solid var(--border)',
    overflow: 'hidden'
  } as CSSProperties,
  table: {
    width: '100%',
    borderCollapse: 'collapse' as const
  } as CSSProperties,
  thead: {
    background: 'var(--gray-50)',
    borderBottom: '1px solid var(--border)'
  } as CSSProperties,
  th: {
    padding: '0.75rem 1rem',
    textAlign: 'left' as const,
    fontWeight: 500,
    fontSize: '0.875rem'
  } as CSSProperties,
  td: {
    padding: '0.75rem 1rem',
    fontSize: '0.875rem'
  } as CSSProperties,
  row: {
    borderBottom: '1px solid var(--border)'
  } as CSSProperties,
  rowHover: {
    background: 'var(--gray-50)',
    cursor: 'pointer'
  } as CSSProperties
}

// 卡片样式
export const cardStyles = {
  base: {
    background: 'white',
    borderRadius: '8px',
    border: '1px solid var(--border)',
    padding: '1.5rem'
  } as CSSProperties,
  header: {
    marginBottom: '1rem',
    paddingBottom: '0.75rem',
    borderBottom: '1px solid var(--border)'
  } as CSSProperties,
  title: {
    fontSize: '1.125rem',
    fontWeight: 600,
    margin: 0
  } as CSSProperties
}

// 模态框样式
export const modalStyles = {
  overlay: {
    position: 'fixed' as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: 'rgba(0, 0, 0, 0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000
  } as CSSProperties,
  content: {
    background: 'white',
    borderRadius: '8px',
    padding: '1.5rem',
    maxWidth: '600px',
    width: '90%',
    maxHeight: '90vh',
    overflow: 'auto'
  } as CSSProperties,
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '1.5rem'
  } as CSSProperties,
  title: {
    fontSize: '1.125rem',
    fontWeight: 600,
    margin: 0
  } as CSSProperties,
  closeButton: {
    background: 'transparent',
    border: 'none',
    fontSize: '1.5rem',
    cursor: 'pointer',
    color: 'var(--gray-500)',
    padding: 0,
    width: '2rem',
    height: '2rem',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  } as CSSProperties,
  footer: {
    marginTop: '1.5rem',
    display: 'flex',
    gap: '0.5rem',
    justifyContent: 'flex-end'
  } as CSSProperties
}

// 表单样式
export const formStyles = {
  field: {
    marginBottom: '1rem'
  } as CSSProperties,
  label: {
    display: 'block',
    marginBottom: '0.5rem',
    fontSize: '0.875rem',
    fontWeight: 500,
    color: 'var(--gray-700)'
  } as CSSProperties,
  input: {
    width: '100%',
    padding: '0.5rem',
    border: '1px solid var(--border)',
    borderRadius: '6px',
    fontSize: '0.875rem',
    boxSizing: 'border-box' as const
  } as CSSProperties,
  textarea: {
    width: '100%',
    padding: '0.5rem',
    border: '1px solid var(--border)',
    borderRadius: '6px',
    fontSize: '0.875rem',
    minHeight: '100px',
    resize: 'vertical' as const,
    boxSizing: 'border-box' as const
  } as CSSProperties,
  select: {
    width: '100%',
    padding: '0.5rem',
    border: '1px solid var(--border)',
    borderRadius: '6px',
    fontSize: '0.875rem',
    boxSizing: 'border-box' as const
  } as CSSProperties,
  error: {
    color: 'var(--error)',
    fontSize: '0.75rem',
    marginTop: '0.25rem'
  } as CSSProperties
}

// 徽章样式
export const badgeStyles = {
  base: {
    padding: '2px 8px',
    borderRadius: '4px',
    fontSize: '0.75rem',
    fontWeight: 500,
    display: 'inline-block'
  } as CSSProperties,
  success: {
    background: '#dcfce7',
    color: '#166534'
  } as CSSProperties,
  error: {
    background: '#fee2e2',
    color: '#991b1b'
  } as CSSProperties,
  warning: {
    background: '#fef3c7',
    color: '#92400e'
  } as CSSProperties,
  info: {
    background: '#dbeafe',
    color: '#1e40af'
  } as CSSProperties
}

// 页面布局样式
export const layoutStyles = {
  page: {
    minHeight: '100vh',
    background: 'var(--gray-50)'
  } as CSSProperties,
  container: {
    padding: '2rem',
    maxWidth: '1400px',
    margin: '0 auto'
  } as CSSProperties,
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '1.5rem'
  } as CSSProperties,
  title: {
    fontSize: '1.5rem',
    fontWeight: 600,
    margin: 0
  } as CSSProperties
}

// 空状态样式
export const emptyStyles = {
  container: {
    padding: '3rem 2rem',
    textAlign: 'center' as const,
    color: 'var(--gray-500)'
  } as CSSProperties,
  icon: {
    fontSize: '3rem',
    marginBottom: '1rem',
    opacity: 0.5
  } as CSSProperties,
  text: {
    fontSize: '0.875rem'
  } as CSSProperties
}

// 加载状态样式
export const loadingStyles = {
  container: {
    padding: '2rem',
    textAlign: 'center' as const,
    color: 'var(--gray-500)'
  } as CSSProperties,
  spinner: {
    display: 'inline-block',
    width: '2rem',
    height: '2rem',
    border: '3px solid var(--gray-200)',
    borderTopColor: 'var(--primary)',
    borderRadius: '50%',
    animation: 'spin 0.8s linear infinite'
  } as CSSProperties
}
