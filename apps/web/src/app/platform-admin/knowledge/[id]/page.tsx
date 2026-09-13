import { BlogDiscoveryDetail } from '@/features/blog'

export default async function PlatformAdminKnowledgeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <BlogDiscoveryDetail id={id} workspaceBasePath="/platform-admin/knowledge" embedded />
}
