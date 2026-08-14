const sha256ByteaTextPattern = /^(?:\\x|\\\\x)([0-9a-f]{64})$/i;

export function normalizeSha256Digest(value) {
  if (typeof value !== 'string') return null;
  return value.match(sha256ByteaTextPattern)?.[1].toLowerCase() ?? null;
}

export function sha256DigestsEqual(left, right) {
  const normalizedLeft = normalizeSha256Digest(left);
  const normalizedRight = normalizeSha256Digest(right);
  return normalizedLeft !== null && normalizedRight !== null && normalizedLeft === normalizedRight;
}

export async function attachmentSha256(adminClient, attachment) {
  const bucket = String(attachment.storageBucket ?? attachment.storage_bucket ?? '');
  const path = String(attachment.storagePath ?? attachment.storage_path ?? '');
  if (!bucket || !path) return null;
  const { data, error } = await adminClient.storage.from(bucket).download(path);
  if (error || !data || data.size > 12_000_000) return null;
  const digest = await crypto.subtle.digest('SHA-256', await data.arrayBuffer());
  return `\\x${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}
