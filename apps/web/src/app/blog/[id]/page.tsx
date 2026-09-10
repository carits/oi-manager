import type { Metadata } from 'next'
import { BlogDiscoveryDetail } from '@/components/blog/BlogDiscoveryDetail'
import { readPublicBlogMetadata } from '@/lib/blogMetadata'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params
  const post = await readPublicBlogMetadata(id)
  const title = post?.currentVersion?.title
  return title ? {
    title: `${title} - Carits`,
    description: post.currentVersion?.summary || 'Carits 知识广场文章',
    alternates: { canonical: `/blog/${post.slug || id}` },
  } : { title: '知识文章 - Carits' }
}

export default async function BlogDiscoveryDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <BlogDiscoveryDetail id={id} />
}
