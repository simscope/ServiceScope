import sharp from 'sharp';
import { reelPresentationSpec, reelSafeZonePixels } from '../../src/features/reel-director/presentationSpec.js';
import { ReelRenderError } from './errors.js';

export async function renderSceneOverlay(scene, outputPath) {
  const zone = reelSafeZonePixels();
  const primary = wrapText(scene.overlayText, 22, 3);
  const secondary = scene.secondaryText ? wrapText(scene.secondaryText, 35, 3) : [];
  const primaryLineHeight = 78;
  const secondaryLineHeight = 46;
  const secondaryHeight = secondary.length ? secondary.length * secondaryLineHeight + 34 : 0;
  const primaryHeight = primary.length * primaryLineHeight + 42;
  const totalHeight = primaryHeight + (secondary.length ? secondaryHeight + 18 : 0);
  const startY = zone.bottom - totalHeight;
  const svg = svgDocument(`
    <rect x="${zone.left - 22}" y="${startY - 18}" width="${zone.width + 12}" height="${primaryHeight}" rx="18" fill="#101820" fill-opacity="0.72"/>
    ${textLines(primary, zone.left, startY + 62, primaryLineHeight, 62, 800, '#ffffff')}
    ${secondary.length ? `<rect x="${zone.left - 12}" y="${startY + primaryHeight + 2}" width="${Math.round(zone.width * 0.9)}" height="${secondaryHeight}" rx="14" fill="#101820" fill-opacity="0.84"/>${textLines(secondary, zone.left + 10, startY + primaryHeight + 49, secondaryLineHeight, 34, 700, '#f8fafc')}` : ''}
  `);
  await rasterize(svg, outputPath);
}

export async function renderBrandCard(brand, outputPath) {
  const displayName = wrapText(brand.displayName, 20, 3);
  const cta = wrapText(brand.cta, 30, 3);
  const svg = svgDocument(`
    <rect width="1080" height="1920" fill="#101820"/>
    <rect x="150" y="610" width="780" height="8" rx="4" fill="#d7f49a"/>
    ${textLines(displayName, 540, 790, 92, 72, 800, '#ffffff', 'middle')}
    ${textLines(cta, 540, 1120, 58, 40, 700, '#d7f49a', 'middle')}
  `);
  await rasterize(svg, outputPath);
}

export async function renderCover(normalizedImagePath, title, outputPath) {
  const lines = wrapText(title, 20, 3);
  const zone = reelSafeZonePixels();
  const overlay = Buffer.from(svgDocument(`
    <rect width="1080" height="1920" fill="#000000" fill-opacity="0.16"/>
    <rect x="${zone.left - 22}" y="${zone.bottom - 330}" width="${zone.width + 12}" height="300" rx="20" fill="#101820" fill-opacity="0.76"/>
    ${textLines(lines, zone.left, zone.bottom - 240, 82, 64, 800, '#ffffff')}
  `));
  await sharp(normalizedImagePath)
    .resize(reelPresentationSpec.width, reelPresentationSpec.height, { fit: 'cover', position: 'centre' })
    .composite([{ input: overlay, top: 0, left: 0 }])
    .jpeg({ quality: 90, chromaSubsampling: '4:2:0' })
    .toFile(outputPath)
    .catch(() => { throw new ReelRenderError('REEL_RENDER_FAILED'); });
}

export function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function wrapText(value, maxCharacters, maxLines) {
  const text = String(value).trim();
  if (/(?:https?:|xlink:href|url\s*\()/i.test(text)) throw new ReelRenderError('REEL_RENDER_INVALID_PLAN');
  const words = text.split(/\s+/).filter(Boolean);
  const lines = [];
  for (const word of words) {
    if (word.length > maxCharacters) throw new ReelRenderError('REEL_RENDER_INVALID_PLAN');
    const current = lines.at(-1);
    if (!current || `${current} ${word}`.length > maxCharacters) lines.push(word);
    else lines[lines.length - 1] = `${current} ${word}`;
  }
  if (lines.length > maxLines) throw new ReelRenderError('REEL_RENDER_INVALID_PLAN');
  return lines;
}

function textLines(lines, x, firstY, lineHeight, fontSize, weight, fill, anchor = 'start') {
  return lines.map((line, index) => `<text x="${x}" y="${firstY + index * lineHeight}" text-anchor="${anchor}" font-family="Arial, sans-serif" font-size="${fontSize}" font-weight="${weight}" fill="${fill}">${escapeXml(line)}</text>`).join('');
}

function svgDocument(body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920" viewBox="0 0 1080 1920">${body}</svg>`;
}

async function rasterize(svg, outputPath) {
  if (/(?:<script|<foreignObject|xlink:href|url\s*\()/i.test(svg)) throw new ReelRenderError('REEL_RENDER_INVALID_PLAN');
  await sharp(Buffer.from(svg), { density: 144 })
    .resize(reelPresentationSpec.width, reelPresentationSpec.height)
    .png()
    .toFile(outputPath)
    .catch(() => { throw new ReelRenderError('REEL_RENDER_FAILED'); });
}
