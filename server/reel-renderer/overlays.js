import sharp from 'sharp';
import { reelPresentationSpec, reelSafeZonePixels } from '../../src/features/reel-director/presentationSpec.js';
import { ReelRenderError } from './errors.js';
import { escapeXml, layoutReelText } from './textLayout.js';

const sceneHorizontalPadding = 22;

export async function renderSceneOverlay(scene, outputPath) {
  const zone = reelSafeZonePixels();
  const primaryBoxWidth = Math.round(zone.width * reelPresentationSpec.text.scenePrimary.widthRatio);
  const secondaryBoxWidth = Math.round(zone.width * reelPresentationSpec.text.sceneSecondary.widthRatio);
  const primary = await layoutReelText(scene.overlayText, 'scenePrimary', {
    maxWidth: primaryBoxWidth - sceneHorizontalPadding * 2,
    maxHeight: Math.round(zone.height * reelPresentationSpec.text.scenePrimary.maxHeightRatio),
    fontWeight: 800,
  });
  const secondary = scene.secondaryText
    ? await layoutReelText(scene.secondaryText, 'sceneSecondary', {
      maxWidth: secondaryBoxWidth - sceneHorizontalPadding * 2,
      maxHeight: Math.round(zone.height * reelPresentationSpec.text.sceneSecondary.maxHeightRatio),
      fontWeight: 700,
    })
    : null;
  const primaryBoxHeight = primary.height + 44;
  const secondaryBoxHeight = secondary ? secondary.height + 32 : 0;
  const gap = secondary ? 18 : 0;
  const startY = zone.bottom - primaryBoxHeight - secondaryBoxHeight - gap;
  if (startY < zone.top) throw new ReelRenderError('REEL_RENDER_TEXT_OVERFLOW');
  const primaryTextX = zone.left + sceneHorizontalPadding;
  const primaryTextY = startY + 22;
  const secondaryY = startY + primaryBoxHeight + gap;
  const secondaryTextX = zone.left + sceneHorizontalPadding;
  const secondaryTextY = secondaryY + 16;
  const primaryBounds = boundsFor(primary, primaryTextX, primaryTextY);
  const secondaryBounds = secondary ? boundsFor(secondary, secondaryTextX, secondaryTextY) : null;
  assertBounds(primaryBounds, zone);
  if (secondaryBounds) assertBounds(secondaryBounds, zone);
  const svg = svgDocument(`
    <rect x="${zone.left}" y="${startY}" width="${primaryBoxWidth}" height="${primaryBoxHeight}" rx="18" fill="#101820" fill-opacity="0.72"/>
    ${textLines(primary, primaryTextX, primaryTextY, 800, '#ffffff')}
    ${secondary ? `<rect x="${zone.left}" y="${secondaryY}" width="${secondaryBoxWidth}" height="${secondaryBoxHeight}" rx="14" fill="#101820" fill-opacity="0.84"/>${textLines(secondary, secondaryTextX, secondaryTextY, 700, '#f8fafc')}` : ''}
  `);
  await rasterize(svg, outputPath);
  return Object.freeze({ primary, secondary, primaryBounds, secondaryBounds, zone });
}

export async function renderBrandCard(brand, outputPath) {
  const zone = reelSafeZonePixels();
  const displayBoxWidth = Math.round(reelPresentationSpec.width * reelPresentationSpec.text.brandDisplayName.widthRatio);
  const ctaBoxWidth = Math.round(reelPresentationSpec.width * reelPresentationSpec.text.brandCta.widthRatio);
  const displayName = await layoutReelText(brand.displayName, 'brandDisplayName', {
    maxWidth: displayBoxWidth,
    maxHeight: Math.round(reelPresentationSpec.height * reelPresentationSpec.text.brandDisplayName.maxHeightRatio),
    fontWeight: 800,
  });
  const cta = await layoutReelText(brand.cta, 'brandCta', {
    maxWidth: ctaBoxWidth,
    maxHeight: Math.round(reelPresentationSpec.height * reelPresentationSpec.text.brandCta.maxHeightRatio),
    fontWeight: 700,
  });
  const gap = 150;
  const blockHeight = displayName.height + gap + cta.height;
  const displayTop = Math.round(reelPresentationSpec.height / 2 - blockHeight / 2);
  const ctaTop = displayTop + displayName.height + gap;
  const centerX = Math.round(zone.left + zone.width / 2);
  const displayBounds = centeredBoundsFor(displayName, centerX, displayTop);
  const ctaBounds = centeredBoundsFor(cta, centerX, ctaTop);
  assertBounds(displayBounds, zone);
  assertBounds(ctaBounds, zone);
  const accentY = Math.max(zone.top, displayTop - 100);
  const svg = svgDocument(`
    <rect width="1080" height="1920" fill="#101820"/>
    <rect x="${zone.left}" y="${accentY}" width="${zone.width}" height="8" rx="4" fill="#d7f49a"/>
    ${textLines(displayName, centerX, displayTop, 800, '#ffffff', 'middle')}
    ${textLines(cta, centerX, ctaTop, 700, '#d7f49a', 'middle')}
  `);
  await rasterize(svg, outputPath);
  return Object.freeze({ displayName, cta, displayBounds, ctaBounds, zone });
}

export async function renderCover(normalizedImagePath, title, outputPath) {
  const zone = reelSafeZonePixels();
  const boxWidth = Math.round(zone.width * reelPresentationSpec.text.cover.widthRatio);
  const layout = await layoutReelText(title, 'cover', {
    maxWidth: boxWidth - sceneHorizontalPadding * 2,
    maxHeight: Math.round(zone.height * reelPresentationSpec.text.cover.maxHeightRatio),
    fontWeight: 800,
  });
  const boxHeight = layout.height + 44;
  const boxY = zone.bottom - boxHeight;
  const textX = zone.left + sceneHorizontalPadding;
  const textY = boxY + 22;
  const textBounds = boundsFor(layout, textX, textY);
  assertBounds(textBounds, zone);
  const overlaySvg = svgDocument(`
    <rect width="1080" height="1920" fill="#000000" fill-opacity="0.16"/>
    <rect x="${zone.left}" y="${boxY}" width="${boxWidth}" height="${boxHeight}" rx="20" fill="#101820" fill-opacity="0.76"/>
    ${textLines(layout, textX, textY, 800, '#ffffff')}
  `);
  await sharp(normalizedImagePath)
    .resize(reelPresentationSpec.width, reelPresentationSpec.height, { fit: 'cover', position: 'centre' })
    .composite([{ input: Buffer.from(overlaySvg), top: 0, left: 0 }])
    .jpeg({ quality: 90, chromaSubsampling: '4:2:0' })
    .toFile(outputPath)
    .catch(() => { throw new ReelRenderError('REEL_RENDER_FAILED'); });
  return Object.freeze({ layout, textBounds, zone });
}

export { escapeXml } from './textLayout.js';

function textLines(layout, x, top, weight, fill, anchor = 'start') {
  return layout.lines.map((line, index) => `<text x="${x}" y="${top + layout.fontSize + index * layout.lineHeight}" text-anchor="${anchor}" font-family="${reelPresentationSpec.text.fontFamily}" font-size="${layout.fontSize}" font-weight="${weight}" fill="${fill}">${escapeXml(line)}</text>`).join('');
}

function boundsFor(layout, x, y) {
  return Object.freeze({ left: x, top: y, right: x + layout.width, bottom: y + layout.height, width: layout.width, height: layout.height });
}

function centeredBoundsFor(layout, centerX, y) {
  return boundsFor(layout, centerX - layout.width / 2, y);
}

function assertBounds(bounds, zone) {
  if (bounds.left < zone.left || bounds.right > zone.right || bounds.top < zone.top || bounds.bottom > zone.bottom
    || bounds.width <= 0 || bounds.height <= 0) {
    throw new ReelRenderError('REEL_RENDER_TEXT_OVERFLOW');
  }
}

function svgDocument(body) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920" viewBox="0 0 1080 1920">${body}</svg>`;
  assertSafeSvg(svg);
  return svg;
}

function assertSafeSvg(svg) {
  if (/(?:<script|<foreignObject|<image|href\s*=|xlink:href|url\s*\()/i.test(svg)) throw new ReelRenderError('REEL_RENDER_INVALID_PLAN');
}

async function rasterize(svg, outputPath) {
  assertSafeSvg(svg);
  await sharp(Buffer.from(svg), { density: 144 })
    .resize(reelPresentationSpec.width, reelPresentationSpec.height)
    .png()
    .toFile(outputPath)
    .catch(() => { throw new ReelRenderError('REEL_RENDER_FAILED'); });
}
