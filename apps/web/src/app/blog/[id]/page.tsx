'use client'
import { useParams } from 'next/navigation'
import { BlogDiscoveryDetail } from '@/components/blog/BlogDiscoveryDetail'
export default function BlogDiscoveryDetailPage() { return <BlogDiscoveryDetail id={useParams().id as string} /> }
