import sharp from 'sharp';
import { reelPresentationSpec } from '../../src/features/reel-director/presentationSpec.js';
import { ReelRenderError } from './errors.js';

const measurementCanvasWidth = 16_384;
const measurementCache = new Map();

export async function layoutReelText(text, styleName, { maxWidth, maxHeight, fontWeight = 700 } = {}) {
  assertSafeOverlayText(text);
  const style = reelPresentationSpec.text[styleName];
  if (!style || !Number.isFinite(maxWidth) || maxWidth <= 0 || !Number.isFinite(maxHeight) || maxHeight <= 0) {
    throw new ReelRenderError('REEL_RENDER_TEXT_OVERFLOW');
  }
  const sizes = candidateFontSizes(style.maxFontSize, style.minFontSize);
  for (const fontSize of sizes) {
    const layout = await layoutAtSize(text.trim(), fontSize, fontWeight, style, maxWidth, maxHeight);
    if (layout) return Object.freeze({ styleName, ...layout, maxWidth, maxHeight });
  }
  throw new ReelRenderError('REEL_RENDER_TEXT_OVERFLOW');
}

export async function measureTextPixels(text, { fontSize, fontWeight = 700 } = {}) {
  assertSafeOverlayText(text);
  if (!Number.isFinite(fontSize) || fontSize <= 0) throw new ReelRenderError('REEL_RENDER_TEXT_OVERFLOW');
  const key = `${fontSize}:${fontWeight}:${text}`;
  const cached = measurementCache.get(key);
  if (cached) return cached;
  const canvasHeight = Math.ceil(fontSize * 2.5) + 32;
  const baseline = Math.ceil(fontSize * 1.35) + 8;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${measurementCanvasWidth}" height="${canvasHeight}" viewBox="0 0 ${measurementCanvasWidth} ${canvasHeight}"><text x="12" y="${baseline}" font-family="${reelPresentationSpec.text.fontFamily}" font-size="${fontSize}" font-weight="${fontWeight}" fill="#ffffff">${escapeXml(text)}</text></svg>`;
  try {
    const { info } = await sharp(Buffer.from(svg), { density: 72 })
      .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer({ resolveWithObject: true });
    const result = Object.freeze({ width: info.width + 4, height: info.height + 4 });
    measurementCache.set(key, result);
    return result;
  } catch (error) {
    if (error instanceof ReelRenderError) throw error;
    throw new ReelRenderError('REEL_RENDER_TEXT_OVERFLOW');
  }
}

export function assertSafeOverlayText(value) {
  if (typeof value !== 'string' || !value.trim() || /(?:https?:|href\s*=|xlink:href|url\s*\()/i.test(value)) {
    throw new ReelRenderError('REEL_RENDER_INVALID_PLAN');
  }
  return value.trim();
}

export function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

async function layoutAtSize(text, fontSize, fontWeight, style, maxWidth, maxHeight) {
  const lines = [];
  let current = '';
  for (const word of text.split(/\s+/u).filter(Boolean)) {
    const candidate = current ? `${current} ${word}` : word;
    const candidateMetrics = await measureTextPixels(candidate, { fontSize, fontWeight });
    if (candidateMetrics.width <= maxWidth) {
      current = candidate;
      continue;
    }
    if (!current) return null;
    lines.push(current);
    if (lines.length >= style.maxLines) return null;
    const wordMetrics = await measureTextPixels(word, { fontSize, fontWeight });
    if (wordMetrics.width > maxWidth) return null;
    current = word;
  }
  if (current) lines.push(current);
  if (!lines.length || lines.length > style.maxLines) return null;
  const metrics = await Promise.all(lines.map((line) => measureTextPixels(line, { fontSize, fontWeight })));
  const lineHeight = Math.ceil(fontSize * style.lineHeightRatio);
  const width = Math.max(...metrics.map((item) => item.width));
  const height = lines.length * lineHeight;
  if (metrics.some((item) => item.height > lineHeight) || width > maxWidth || height > maxHeight) return null;
  return Object.freeze({
    lines: Object.freeze(lines),
    lineMetrics: Object.freeze(metrics),
    fontSize,
    lineHeight,
    width,
    height,
    minFontSize: style.minFontSize,
    maxLines: style.maxLines,
  });
}

function candidateFontSizes(maximum, minimum) {
  const values = [];
  for (let size = maximum; size >= minimum; size -= 2) values.push(size);
  if (values.at(-1) !== minimum) values.push(minimum);
  return values;
}
