import { BlogDiscoveryDetail } from '@/features/blog'

export default async function AdminKnowledgeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <BlogDiscoveryDetail id={id} workspaceBasePath="/admin/knowledge" embedded />
}
