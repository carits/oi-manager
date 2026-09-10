import { BlogDiscoveryDetail } from '@/components/blog/BlogDiscoveryDetail'

export default async function PersonalKnowledgeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <BlogDiscoveryDetail id={id} workspaceBasePath="/personal/knowledge" embedded />
}
