import Link from 'next/link'

export default function Home() {
  return (
    <main style={{ padding: '2rem', maxWidth: '800px', margin: '0 auto' }}>
      <h1 style={{ marginBottom: '2rem', fontSize: '2rem', fontWeight: 600 }}>
        <img src="/logo.png" alt="Carits" style={{ height: '36px', marginBottom: '2rem'}} />
      </h1>

      <div style={{ display: 'grid', gap: '1rem', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
        <Link
          href="/login"
          style={{
            display: 'block',
            padding: '1.5rem',
            border: '1px solid var(--border)',
            borderRadius: '8px',
            background: 'var(--gray-50)',
            transition: 'background 0.2s'
          }}
        >
          <h2 style={{ fontSize: '1.25rem', marginBottom: '0.5rem' }}>登录入口</h2>
          <p style={{ color: 'var(--gray-600)', fontSize: '0.875rem' }}>
            超管 / 老师 / 学生
          </p>
        </Link>
      </div>

      <div style={{ marginTop: '3rem', padding: '1.5rem', background: 'var(--gray-50)', borderRadius: '8px' }}>
        <h3 style={{ marginBottom: '1rem' }}>系统说明</h3>
        <p style={{ color: 'var(--gray-600)' }}>
          面向信息学竞赛训练场景的管理平台<br/>
          核心组织：学校 &gt; 团队 &gt; 教师/学生
        </p>
      </div>
    </main>
  )
}
