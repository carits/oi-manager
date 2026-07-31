import { SkeletonRegion } from './AsyncRegion'

export function PageLoadingFrame({
  title,
  rows = 7,
}: {
  title: string
  rows?: number
}) {
  return (
    <section style={{ padding: '2rem', maxWidth: '1200px', margin: '0 auto' }}>
      <h1 style={{ margin: '0 0 1.5rem', fontSize: '1.5rem', fontWeight: 600 }}>
        {title}
      </h1>
      <SkeletonRegion rows={rows} />
    </section>
  )
}
