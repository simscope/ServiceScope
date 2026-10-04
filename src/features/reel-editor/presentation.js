// v2 is intentionally independent of the immutable reel-presentation-v1 profile.
export const editorContract = 'reel-manager-presentation-v2';
export const editorLimits = Object.freeze({ width: 1080, height: 1920, fps: 30, scenes: 8, seconds: 60 });
export const briefFields = ['problem', 'work', 'result', 'checks', 'prohibited'];
export const roles = ['problem', 'process', 'result', 'supporting', 'maintenance'];
export const motions = ['none', 'zoom_in', 'zoom_out', 'pan_left', 'pan_right', 'pan_up', 'pan_down'];
export function newScene(attachmentId, index = 0) {
  return { id: `scene-${index + 1}`, attachmentId, role: 'supporting', frames: 120,
    crop: { mode: 'fill', scale: 1, x: .5, y: .5 },
    motion: { kind: 'none', intensity: .05, start: { scale: 1, x: .5, y: .5 }, end: { scale: 1, x: .5, y: .5 } },
    transition: { kind: 'cut', frames: 0 },
    text: { enabled: true, label: '', headline: '', subline: '', factRefs: [], x: .1, y: .58,
      width: .76, fontSize: 58, align: 'left', color: '#ffffff', background: '#102736', backplate: true,
      appear: 0, disappear: 120 } };
}
export function newDraft(jobId, media = []) {
  return { contract: editorContract, jobId, brief: { problem: '', work: '', result: '', checks: '', prohibited: '', language: 'en', emphasis: 'process', mediaRefs: [] },
    scenes: media.slice(0, 3).map((m, i) => newScene(m.attachmentId, i)),
    brand: { enabled: false, displayName: '', logo: false, cta: '', frames: 60 }, caption: '' };
}
export function timeline(draft) {
  let cursor = 0;
  const items = draft.scenes.map((scene, i) => {
    const incoming = i ? draft.scenes[i - 1].transition.frames : 0;
    const item = { scene, index: i, start: cursor, end: cursor + scene.frames, incoming };
    cursor = item.end; return item;
  });
  return { items, frames: cursor + (draft.brand.enabled ? draft.brand.frames : 0), sceneFrames: cursor };
}
export function motionAt(scene, localFrame, incoming = 0) {
  const motion = scene.motion;
  // The incoming scene already advances during its transition; it never resets at its own start.
  const progress = Math.min(1, Math.max(0, (localFrame + incoming) / Math.max(1, scene.frames + incoming - 1)));
  const end = motion.kind === 'none' ? motion.start : motion.end;
  const lerp = (a, b) => a + (b - a) * progress;
  return { scale: scene.crop.scale * lerp(motion.start.scale, end.scale),
    x: Math.max(0, Math.min(1, scene.crop.x + lerp(motion.start.x, end.x) - .5)),
    y: Math.max(0, Math.min(1, scene.crop.y + lerp(motion.start.y, end.y) - .5)) };
}
export function imageGeometry(scene, media, frame, incoming = 0) {
  const pose = motionAt(scene, frame, incoming);
  const base = (scene.crop.mode === 'fit' ? Math.min : Math.max)(1080 / media.width, 1920 / media.height);
  const width = media.width * base * pose.scale, height = media.height * base * pose.scale;
  return { width, height, x: (1080 - width) * pose.x, y: (1920 - height) * pose.y };
}
// Conservative deterministic wrapping shared by browser SVG and the server rasterizer.
// Font size is never reduced, and overflow is a validation error rather than truncation.
export function wrapText(value, fontSize, width) {
  const capacity = Math.max(1, Math.floor(width / (fontSize * .62)));
  const lines = [];
  for (const paragraph of value.split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      if ((line ? line.length + 1 : 0) + word.length > capacity && line) { lines.push(line); line = ''; }
      line = line ? `${line} ${word}` : word;
    }
    lines.push(line);
  }
  return { lines, overflow: lines.some(line => line.length > capacity) };
}
export function textLayout(text) {
  const label = wrapText(text.label, 30, text.width * 1080);
  const headline = wrapText(text.headline, text.fontSize, text.width * 1080);
  const subline = wrapText(text.subline, 36, text.width * 1080);
  const height = (text.label ? label.lines.length * 38 + 18 : 0) + (text.headline ? headline.lines.length * text.fontSize * 1.2 + 22 : 0) + (text.subline ? subline.lines.length * 46 : 0);
  return { label, headline, subline, height, overflow: label.overflow || headline.overflow || subline.overflow || headline.lines.length > 4 || subline.lines.length > 3 || text.y * 1920 + height > 1459 || text.x + text.width > .86 || text.y < .12 };
}
export function draftErrors(draft) {
  const errors = [];
  if (!draft.brief.problem.trim() || !draft.brief.work.trim()) errors.push('Confirm what was found and what was actually done.');
  if (!draft.scenes.length || draft.scenes.length > editorLimits.scenes) errors.push('Choose 1–8 photo scenes.');
  if (timeline(draft).frames > 1800) errors.push('Maximum duration is 60 seconds.');
  draft.scenes.forEach((s, i) => {
    if (s.text.enabled && textLayout(s.text).overflow) errors.push(`Scene ${i + 1}: text exceeds the safe area; shorten it or adjust its position/size.`);
    if (s.text.enabled && !s.text.headline.trim()) errors.push(`Scene ${i + 1}: enter a headline or turn text off.`);
  });
  return errors;
}
export function setMotion(scene, kind, intensity) {
  const start = { scale: 1, x: .5, y: .5 }, end = { ...start };
  if (kind === 'zoom_in') end.scale += intensity;
  if (kind === 'zoom_out') start.scale += intensity;
  if (kind.startsWith('pan_')) {
    start.scale = end.scale = 1 + intensity;
    const axis = ['pan_left', 'pan_right'].includes(kind) ? 'x' : 'y';
    const direction = ['pan_left', 'pan_up'].includes(kind) ? 1 : -1;
    start[axis] = .5 - direction * intensity * 1.25; end[axis] = .5 + direction * intensity * 1.25;
  }
  return { kind, intensity, start, end };
}
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);
function drawText(text) {
  const layout = textLayout(text), x = text.x * 1080, y = text.y * 1920, width = text.width * 1080;
  const anchor = text.align === 'center' ? 'middle' : text.align === 'right' ? 'end' : 'start';
  const tx = x + (text.align === 'center' ? width / 2 : text.align === 'right' ? width : 0);
  let cursor = y;
  let output = text.backplate ? `<rect x="${x - 22}" y="${y - 20}" width="${width + 44}" height="${layout.height + 40}" rx="16" fill="${text.background}" fill-opacity=".86"/>` : '';
  for (const [value, size, lines, spacing, weight] of [[text.label, 30, layout.label.lines, 38, 400], [text.headline, text.fontSize, layout.headline.lines, text.fontSize * 1.2, 400], [text.subline, 36, layout.subline.lines, 46, 400]]) {
    if (!value) continue;
    for (const line of lines) { output += `<text x="${tx}" y="${cursor + size}" fill="${text.color}" font-size="${size}" font-weight="${weight}" text-anchor="${anchor}" font-family="DejaVu Sans">${escape(line)}</text>`; cursor += spacing; }
    cursor += 18;
  }
  return output;
}
function drawScene(scene, media, local, incoming) {
  const asset = media.get(scene.attachmentId);
  if (!asset) return '';
  const g = imageGeometry(scene, asset, local, incoming);
  return `<image href="${escape(asset.url)}" x="${g.x}" y="${g.y}" width="${g.width}" height="${g.height}" preserveAspectRatio="none"/>`
    + (scene.text.enabled && Math.max(0, local) >= scene.text.appear && Math.max(0, local) < scene.text.disappear ? drawText(scene.text) : '');
}
export function frameSvg(draft, media, frame, safeArea = false) {
  const tl = timeline(draft), bounded = Math.max(0, Math.min(tl.frames - 1, Math.floor(frame)));
  const item = tl.items.find(item => bounded >= item.start && bounded < item.end);
  let body = '';
  if (item) {
    const local = bounded - item.start, out = item.scene.transition;
    body = drawScene(item.scene, media, local, item.incoming);
    if (out.frames && local >= item.scene.frames - out.frames) {
      const next = tl.items[item.index + 1];
      const elapsed = local - (item.scene.frames - out.frames);
      const opacity = (elapsed + 1) / out.frames;
      const content = next ? drawScene(next.scene, media, elapsed - out.frames, out.frames) : brandSvg(draft.brand, media);
      if (out.kind === 'fade_black') body = opacity < .5 ? `<g opacity="${1 - opacity * 2}">${body}</g>` : `<g opacity="${opacity * 2 - 1}">${content}</g>`;
      else body += `<g opacity="${opacity}">${content}</g>`;
    }
  } else body = brandSvg(draft.brand, media);
  if (safeArea) body += '<rect x="97" y="230" width="832" height="1229" fill="none" stroke="#69d4ff" stroke-width="3" stroke-dasharray="12 12"/>';
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 1080 1920" width="1080" height="1920"><rect width="1080" height="1920" fill="#07131c"/>${body}</svg>`;
}
function brandSvg(brand, media) {
  const logo = brand.logo ? media.get('brand-logo') : null;
  return (logo ? `<image href="${escape(logo.url)}" x="340" y="430" width="400" height="300" preserveAspectRatio="xMidYMid meet"/>` : '')
    + drawText({ label: '', headline: brand.displayName, subline: brand.cta, x: .12, y: .43, width: .72, fontSize: 70, align: 'center', color: '#ffffff', background: '#102736', backplate: false });
}
