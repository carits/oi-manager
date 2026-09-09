'use client'

import { useParams } from 'next/navigation'
import { BlogWorkspace } from '@/components/blog/BlogWorkspace'

export default function PersonalBlogPage() {
  return <BlogWorkspace postId={useParams().id as string} />
}
