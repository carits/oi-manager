import { BlogDiscoveryDetail } from '@/components/blog/BlogDiscoveryDetail'

export default async function AdminKnowledgeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <BlogDiscoveryDetail id={id} workspaceBasePath="/admin/knowledge" embedded />
}
