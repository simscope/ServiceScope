import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { EditorError } from './service.js';
// The authenticated context RPC authorizes the Job before these privileged downloads.
// SHA comparison ties existing privacy review to the actual current bytes.
export async function hydrateEditorContext(client, context, attachmentIds, assets = new Map()) {
  const ids = [...new Set(attachmentIds)];
  if (ids.length > 8 || ids.some(id => !context.media.some(m => m.attachmentId === id))) throw new EditorError('EDITOR_MEDIA_STALE');
  for (const asset of context.media.filter(m => ids.includes(m.attachmentId))) {
    if (asset.privacy !== 'passed') continue;
    const bytes = await client.downloadBounded(asset.bucket, asset.path, 12000000);
    const identity = createHash('sha256').update(bytes).digest('hex');
    if (identity !== asset.identity) throw new EditorError('EDITOR_MEDIA_STALE');
    const metadata = await sharp(bytes).rotate().metadata();
    const swapped = [5, 6, 7, 8].includes(metadata.orientation);
    asset.width = swapped ? metadata.height : metadata.width;
    asset.height = swapped ? metadata.width : metadata.height;
    if (!asset.width || !asset.height || asset.width * asset.height > 60000000) throw new EditorError('EDITOR_MEDIA_INVALID');
    assets.set(asset.attachmentId, bytes);
  }
  if (context.brand.logoAvailable && context.brand.logoPath) {
    const bytes = await client.downloadBounded(context.brand.logoBucket, context.brand.logoPath, 12000000);
    const metadata = await sharp(bytes).metadata();
    if (!['png', 'jpeg', 'webp'].includes(metadata.format) || !metadata.width || !metadata.height) throw new EditorError('EDITOR_BRAND_NOT_AUTHORIZED');
    const asset = { attachmentId: 'brand-logo', width: metadata.width, height: metadata.height, identity: createHash('sha256').update(bytes).digest('hex'), mimeType: `image/${metadata.format}`, privacy: 'passed' };
    context.media = [...context.media.filter(m => m.attachmentId !== 'brand-logo'), asset];
    assets.set('brand-logo', bytes);
  }
  // No Storage paths, job/customer records or private values go into sandbox authority.
  return { context, assets };
}
