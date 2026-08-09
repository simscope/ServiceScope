export async function attachmentSha256(adminClient, attachment) {
  const bucket = String(attachment.storageBucket ?? attachment.storage_bucket ?? '');
  const path = String(attachment.storagePath ?? attachment.storage_path ?? '');
  if (!bucket || !path) return null;
  const { data, error } = await adminClient.storage.from(bucket).download(path);
  if (error || !data || data.size > 12_000_000) return null;
  const digest = await crypto.subtle.digest('SHA-256', await data.arrayBuffer());
  return `\\x${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}
