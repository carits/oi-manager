export function hasTrainingAttachments(
  allAttachments: Record<string, readonly unknown[]>,
): boolean {
  return Object.values(allAttachments).some(attachments => attachments.length > 0)
}
