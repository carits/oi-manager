import Link from 'next/link'

export default function NotFound() {
  return (
    <main style={{ maxWidth: '720px', margin: '0 auto', padding: '3rem 1.5rem' }}>
      <p style={{ margin: '0 0 0.5rem', color: 'var(--text-muted)' }}>404</p>
      <h1 style={{ margin: '0 0 0.75rem', fontSize: '1.5rem' }}>页面不存在</h1>
      <p style={{ margin: '0 0 1.5rem', color: 'var(--text-secondary)' }}>
        地址可能已经变更，或者当前账号没有对应的页面入口。
      </p>
      <Link href="/" style={{ color: 'var(--primary)' }}>返回首页</Link>
    </main>
  )
}
