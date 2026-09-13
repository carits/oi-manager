'use client'

import { useParams } from 'next/navigation'
import { BlogWorkspace } from '@/features/blog'

export default function PersonalBlogPage() {
  return <BlogWorkspace postId={useParams().id as string} />
}
