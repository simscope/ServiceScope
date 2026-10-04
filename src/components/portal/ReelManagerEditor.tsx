import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { briefFields, draftErrors, frameSvg, imageGeometry, motions, newDraft, newScene, roles, setMotion, timeline } from '../../features/reel-editor/presentation.js';
import { editorBackend } from '../../features/reel-editor/client';
import type { EditorBackend, EditorBrand, EditorDraft, EditorMedia, EditorRow, EditorScene } from '../../features/reel-editor/types';
import './ReelManagerEditor.css';
const FacebookReelPublishPanel = lazy(() => import('./FacebookReelPublishPanel').then(module => ({ default: module.FacebookReelPublishPanel })));

type Props = { jobId: string; companyId?: string; media: EditorMedia[]; backend?: EditorBackend; onClose?: () => void; localDemo?: boolean };
const briefLabels = { problem: 'Problem found *', work: 'Work actually done *', result: 'Observed result (optional)', checks: 'Post-repair checks (optional)', prohibited: 'Forbidden phrases (one exact phrase per line). Review photo content before approval.' };
export function ReelManagerEditor({ jobId, companyId, media: inputMedia, backend: suppliedBackend, onClose, localDemo }: Props) {
  const backend = useMemo(() => suppliedBackend ?? editorBackend(jobId), [suppliedBackend, jobId]);
  const [draft, setDraft] = useState<EditorDraft>(() => newDraft(jobId, inputMedia));
  const [row, setRow] = useState<EditorRow | null>(null), [brand, setBrand] = useState<EditorBrand>({ displayName: '', logoAvailable: false, allowedCtas: [] });
  const [media, setMedia] = useState(inputMedia), [selected, setSelected] = useState(0), [frame, setFrame] = useState(0), [playing, setPlaying] = useState(false);
  const [safe, setSafe] = useState(true), [ready, setReady] = useState(false), [pending, setPending] = useState(''), [error, setError] = useState('');
  const [confirmed, setConfirmed] = useState(false), [video, setVideo] = useState(''), [renderStatus, setRenderStatus] = useState('');
  const [comparison, setComparison] = useState('');
  const [renderId, setRenderId] = useState(''), [publicationReview, setPublicationReview] = useState(false);
  const history = useRef<EditorDraft[]>([]), future = useRef<EditorDraft[]>([]);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [, setHistoryVersion] = useState(0);
  const drag = useRef<{ x: number; y: number; cropX: number; cropY: number; width: number; height: number } | null>(null);
  const tl = useMemo(() => timeline(draft), [draft]);
  const scene = draft.scenes[selected];
  const dirty = !row || JSON.stringify(row.draft) !== JSON.stringify(draft);
  const approval = !dirty && row?.approvalApplicable !== false && row?.approval?.draftRevision === row?.revision ? row.approval : null;
  const mediaMap = useMemo(() => new Map(media.map(m => [m.attachmentId, m])), [media]);
  const errors: string[] = useMemo(() => draftErrors(draft), [draft]);
  useEffect(() => { const active = tl.items.find(item => frame >= item.start && frame < item.end); if (active) setSelected(active.index); }, [frame, tl]);
  useEffect(() => {
    let active = true;
    backend.load().then(value => { if (!active) return; setRow(value.row); setBrand(value.brand);
      if (value.row) setDraft(value.row.draft);
      if (value.row?.approvalError) setError(`${value.row.approvalError}: save an explicit new draft version before approval.`);
      if (value.render) { setRenderStatus(value.render.status); setVideo(value.render.videoUrl ?? ''); setRenderId(value.render.renderJobId ?? ''); }
      setMedia([...inputMedia.map(m => ({ ...m, ...value.media.find(v => v.attachmentId === m.attachmentId), url: m.url, name: m.name })), ...value.media.filter(m => m.attachmentId === 'brand-logo') as EditorMedia[]]);
    }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [backend, inputMedia]);
  useEffect(() => {
    let active = true; setReady(false); setPlaying(false);
    Promise.all([document.fonts.load('400 58px "DejaVu Sans"'), document.fonts.ready,
      ...draft.scenes.map(s => new Promise<void>((resolve, reject) => { const image = new Image(); image.onload = () => { if (active) setMedia(current => current.some(m => m.attachmentId === s.attachmentId && !m.width) ? current.map(m => m.attachmentId === s.attachmentId ? { ...m, width: image.naturalWidth, height: image.naturalHeight } : m) : current); resolve(); }; image.onerror = () => reject(new Error('EDITOR_IMAGE_UNAVAILABLE')); image.src = mediaMap.get(s.attachmentId)?.url ?? ''; }))])
      .then(() => { if (active) setReady(true); }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [mediaMap, draft.scenes.map(s => s.attachmentId).join('|')]);
  useEffect(() => {
    if (!playing || !ready) return;
    const start = performance.now(), first = frame; let raf = 0;
    const tick = (now: number) => { const next = first + Math.floor((now - start) * 30 / 1000); setFrame(Math.min(next, tl.frames - 1));
      if (next >= tl.frames - 1) setPlaying(false); else raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick); return () => cancelAnimationFrame(raf);
  }, [playing, ready, tl.frames]);
  useEffect(() => { const warn = (event: BeforeUnloadEvent) => { if (dirty) event.preventDefault(); }; window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn); }, [dirty]);
  function change(next: EditorDraft) { const visualChanged = JSON.stringify({ ...draft, caption: '' }) !== JSON.stringify({ ...next, caption: '' }); history.current.push(structuredClone(draft)); if (history.current.length > 80) history.current.shift(); future.current = []; setDraft(next); setFrame(f => Math.min(f, Math.max(0, timeline(next).frames - 1))); setConfirmed(false); setHistoryVersion(v => v + 1); setPlaying(false); if (visualChanged) setVideo(''); setPublicationReview(false); }
  function editScene(patch: Partial<EditorScene>) { change({ ...draft, scenes: draft.scenes.map((s, i) => i === selected ? { ...s, ...patch } : s) }); }
  function undo(redo = false) { const source = redo ? future.current : history.current, target = redo ? history.current : future.current; const next = source.pop(); if (next) { target.push(draft); setDraft(next); setSelected(i => Math.min(i, next.scenes.length - 1)); setConfirmed(false); setPlaying(false); setHistoryVersion(v => v + 1); } }
  async function action(name: string, operation: () => Promise<void>) { if (pending) return; setPending(name); setError(''); setPlaying(false); try { await operation(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setPending(''); } }
  function choose(index: number) { setSelected(index); setFrame(tl.items[index]?.start ?? 0); setPlaying(false); }
  function move(offset: number) { const target = selected + offset; if (target < 0 || target >= draft.scenes.length) return; const scenes = [...draft.scenes]; [scenes[selected], scenes[target]] = [scenes[target], scenes[selected]]; const next = { ...draft, scenes }; change(next); setSelected(target); setFrame(timeline(next).items[target].start); }
  const num = (label: string, value: number, min: number, max: number, step: number, callback: (v: number) => void) => <label>{label}<input type="number" value={value} min={min} max={max} step={step} onChange={e => { const n = Number(e.target.value); if (Number.isFinite(n) && n >= min && n <= max) callback(n); }} /></label>;
  return <section className="reel-manager-editor" aria-label="Manager Reel Editor">
    <header><div><h2>Reel Editor <small>Photo story · v2</small></h2><p>{localDemo ? 'Local review · sample media and facts · no Production connection' : 'Tell the confirmed repair story. Photos do not prove repair outcomes.'}</p></div>{onClose && <button onClick={onClose}>Close</button>}</header>
    <div className="reel-editor-toolbar"><span>{dirty ? 'Unsaved changes' : `Saved version ${row?.revision}`} · {approval ? 'Approved exact version' : 'Approval required'}</span>
      <button disabled={!history.current.length} onClick={() => undo()}>Undo</button><button disabled={!future.current.length} onClick={() => undo(true)}>Redo</button>
      <button disabled={!row || !!pending} onClick={() => { if (row) { change(structuredClone(row.draft)); setSelected(0); setFrame(0); } }}>Reset to saved</button>
      <button disabled={!!pending || (!dirty && !confirmed && row?.approvalApplicable !== false)} onClick={() => action('save', async () => { const result = await backend.save(draft, row?.revision ?? 0, confirmed); setRow(result.row); setDraft(result.row.draft); setConfirmed(false); })}>{pending === 'save' ? 'Saving…' : 'Save draft'}</button>
      <button disabled={dirty || !!pending || errors.length > 0 || !row?.brief_confirmation} onClick={() => action('approve', async () => { const result = await backend.approve(row!.revision); setRow(result.row); })}>Approve this version</button>
      <button disabled={!approval || !!pending} onClick={() => action('render', async () => { const result = await backend.render(approval!); setRenderStatus(result.status); setRenderId(result.renderJobId ?? ''); setVideo(result.videoUrl ?? ''); })}>{localDemo ? 'Export approved MP4 locally' : 'Create MP4'}</button>
      {renderStatus && <button disabled={!!pending || !approval} onClick={() => action('status', async () => { const result = await backend.load(); if (result.row?.approval?.creativePlanId !== approval?.creativePlanId) throw new Error('EDITOR_DRAFT_CONFLICT'); if (result.render) { setRenderStatus(result.render.status); setVideo(result.render.videoUrl ?? ''); setRenderId(result.render.renderJobId ?? ''); } })}>Refresh export status</button>}
      {companyId && <button disabled={!approval || renderStatus !== 'completed' || !video || !renderId} onClick={() => setPublicationReview(true)}>Publication review</button>}
      <span>Publication: separate review after MP4</span>
    </div>
    {error && <p role="alert" className="editor-error">{error}</p>}
    <details className="editor-brief" open><summary>Confirmed repair brief</summary><div className="editor-brief-grid">
      {briefFields.map((field: keyof typeof briefLabels) => <label key={field}>{briefLabels[field]}<textarea maxLength={700} value={draft.brief[field]} onChange={e => change({ ...draft, brief: { ...draft.brief, [field]: e.target.value } })} /></label>)}
      <label>Language<input value={draft.brief.language} onChange={e => change({ ...draft, brief: { ...draft.brief, language: e.target.value } })} /></label>
      <label>Emphasis<select value={draft.brief.emphasis} onChange={e => change({ ...draft, brief: { ...draft.brief, emphasis: e.target.value } })}>{roles.map(r => <option key={r}>{r}</option>)}</select></label>
      <label>Evidence photo references<select multiple value={draft.brief.mediaRefs} onChange={e => change({ ...draft, brief: { ...draft.brief, mediaRefs: Array.from(e.target.selectedOptions, o => o.value) } })}>{media.map(m => <option key={m.attachmentId} value={m.attachmentId}>{m.name}</option>)}</select></label>
    </div><label className="editor-check"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />I confirm these facts as the manager. Save records my identity, time and this version.</label>
      {row?.brief_confirmation && <p>Saved confirmation: {row.brief_confirmation.confirmedAt} · version {row.brief_confirmation.revision}</p>}
    </details>
    <div className="editor-columns"><aside><h3>Media & scenes</h3><p>1–8 photos · up to 60 seconds</p>
      {media.filter(m => m.attachmentId !== 'brand-logo').map(m => <div className="editor-media" key={m.attachmentId}><img src={m.url} alt={m.name} /><div>{m.name}<small>Privacy: {m.privacy}</small><button disabled={m.privacy !== 'passed' || draft.scenes.length >= 8} onClick={() => change({ ...draft, scenes: [...draft.scenes, { ...newScene(m.attachmentId, draft.scenes.length), id: crypto.randomUUID() }] })}>Add scene</button></div></div>)}
      {draft.scenes.map((s, i) => <button className={i === selected ? 'editor-selected' : ''} key={s.id} onClick={() => choose(i)}>Scene {i + 1} · {s.role} · {(s.frames / 30).toFixed(2)}s</button>)}
      <div className="editor-row"><button onClick={() => move(-1)} disabled={selected === 0}>Move earlier</button><button onClick={() => move(1)} disabled={selected === draft.scenes.length - 1}>Move later</button></div>
      <button disabled={draft.scenes.length < 2} onClick={() => { change({ ...draft, scenes: draft.scenes.filter((_, i) => i !== selected) }); setSelected(Math.max(0, selected - 1)); setFrame(0); }}>Delete selected scene</button>
    </aside><main><div className="editor-preview-pair"><div className="editor-canvas" aria-label="9:16 preview; drag to crop" onPointerDown={e => { if (!scene) return; history.current.push(structuredClone(draft)); future.current = []; setHistoryVersion(v => v + 1); const bounds = e.currentTarget.getBoundingClientRect(); drag.current = { x: e.clientX, y: e.clientY, cropX: scene.crop.x, cropY: scene.crop.y, width: bounds.width, height: bounds.height }; e.currentTarget.setPointerCapture(e.pointerId); setPlaying(false); setFrame(tl.items[selected].start); }}
      onPointerMove={e => { const start = drag.current, asset = mediaMap.get(scene?.attachmentId); if (!start || !asset) return; const g = imageGeometry(scene, asset, 0, tl.items[selected].incoming);
        const dx = (e.clientX - start.x) * 1080 / start.width, dy = (e.clientY - start.y) * 1920 / start.height;
        const crop = { ...scene.crop, x: Math.max(0, Math.min(1, start.cropX + (g.width === 1080 ? 0 : dx / (1080 - g.width)))), y: Math.max(0, Math.min(1, start.cropY + (g.height === 1920 ? 0 : dy / (1920 - g.height)))) };
        setDraft(current => ({ ...current, scenes: current.scenes.map((s, i) => i === selected ? { ...s, crop } : s) })); setConfirmed(false);
      }} onPointerUp={() => { drag.current = null; setVideo(''); setPublicationReview(false); }} onPointerCancel={() => { drag.current = null; }} dangerouslySetInnerHTML={{ __html: frameSvg(draft, mediaMap, frame, safe) }} />
      {video && <video ref={videoRef} controls src={video} aria-label="Approved MP4 export" onSeeked={event => setComparison(`MP4 at ${event.currentTarget.currentTime.toFixed(2)} seconds`)} />}</div>
      <div className="editor-row"><button disabled={!ready} onClick={() => { if (frame >= tl.frames - 1) setFrame(0); setPlaying(v => !v); }}>{playing ? 'Pause' : 'Play preview'}</button><label className="editor-check"><input type="checkbox" checked={safe} onChange={e => setSafe(e.target.checked)} />Safe areas</label></div>
      <p>{ready ? 'Media and font ready' : 'Loading media / font…'} · {(frame / 30).toFixed(2)} / {(tl.frames / 30).toFixed(2)} seconds</p>
      <input aria-label="Timeline scrub" type="range" min={0} max={Math.max(0, tl.frames - 1)} value={frame} onChange={e => { setPlaying(false); setFrame(Number(e.target.value)); }} />
      {num('Preview frame', frame, 0, Math.max(0, tl.frames - 1), 1, v => { setPlaying(false); setFrame(v); })}
      <div className="editor-timeline">{tl.items.map(item => <button style={{ flex: item.scene.frames }} key={item.scene.id} onClick={() => choose(item.index)}> {item.index + 1} · {(item.scene.frames / 30).toFixed(2)}s<br />{item.scene.transition.kind}</button>)}{draft.brand.enabled && <span>Brand {draft.brand.frames / 30}s</span>}</div>
      {errors.map(message => <p role="alert" className="editor-error" key={message}>{message}</p>)}
      {renderStatus && <p>Export: {renderStatus}</p>}{video && <><button onClick={() => { if (videoRef.current) { videoRef.current.pause(); videoRef.current.currentTime = frame / 30; setComparison(`Seeking MP4 to ${(frame / 30).toFixed(2)} seconds…`); } }}>Compare MP4 at preview frame</button><p aria-live="polite">{comparison}</p></>}
    </main><aside>{scene && <><h3>Scene {selected + 1}</h3>
      <label>Photo<select value={scene.attachmentId} onChange={e => editScene({ attachmentId: e.target.value })}>{media.map(m => <option disabled={m.privacy !== 'passed'} key={m.attachmentId} value={m.attachmentId}>{m.name}</option>)}</select></label>
      <label>Role<select value={scene.role} onChange={e => editScene({ role: e.target.value })}>{roles.map(r => <option key={r}>{r}</option>)}</select></label>
      {num('Duration (seconds)', scene.frames / 30, 1, 10, 1 / 30, v => editScene({ frames: Math.round(v * 30), text: { ...scene.text, appear: 0, disappear: Math.round(v * 30) } }))}
      <h4>Crop</h4><label>Fit / Fill<select value={scene.crop.mode} onChange={e => editScene({ crop: { ...scene.crop, mode: e.target.value } })}><option value="fill">Fill</option><option value="fit">Fit</option></select></label>
      {num('Scale', scene.crop.scale, 1, 2, .01, v => editScene({ crop: { ...scene.crop, scale: v } }))}{num('Focal X', scene.crop.x, 0, 1, .01, v => editScene({ crop: { ...scene.crop, x: v } }))}{num('Focal Y', scene.crop.y, 0, 1, .01, v => editScene({ crop: { ...scene.crop, y: v } }))}
      <button onClick={() => editScene({ crop: { mode: 'fill', scale: 1, x: .5, y: .5 } })}>Reset crop</button>
      <h4>Motion</h4><label>Motion<select value={scene.motion.kind} onChange={e => editScene({ motion: setMotion(scene, e.target.value, scene.motion.intensity) })}>{motions.map(m => <option key={m}>{m}</option>)}</select></label>
      {num('Intensity', scene.motion.intensity, 0, .2, .01, v => editScene({ motion: setMotion(scene, scene.motion.kind, v) }))}
      {scene.motion.kind !== 'none' && ['start', 'end'].map((endpoint: 'start' | 'end') => <details key={endpoint}><summary>{endpoint} position</summary>{(['x', 'y', 'scale'] as const).map(axis => <div key={axis}>{num(`${endpoint} ${axis}`, scene.motion[endpoint][axis], axis === 'scale' ? 1 : 0, axis === 'scale' ? 1.2 : 1, .01, v => editScene({ motion: { ...scene.motion, [endpoint]: { ...scene.motion[endpoint], [axis]: v } } }))}</div>)}</details>)}
      <h4>Text</h4><label className="editor-check"><input type="checkbox" checked={scene.text.enabled} onChange={e => editScene({ text: { ...scene.text, enabled: e.target.checked } })} />Show text</label>
      <label>Confirmed fact source<select value={scene.text.factRefs[0] ?? ''} onChange={e => editScene({ text: { ...scene.text, factRefs: e.target.value ? [e.target.value] : [] } })}><option value="">Choose a confirmed fact</option>{['problem', 'work', 'result', 'checks'].map(f => <option key={f}>{f}</option>)}</select></label>
      <button disabled={!scene.text.factRefs.length} onClick={() => editScene({ text: { ...scene.text, headline: draft.brief[scene.text.factRefs[0]], subline: '' } })}>Use exact brief text</button>
      {(['label', 'headline', 'subline'] as const).map(field => <label key={field}>{field}<textarea value={scene.text[field]} maxLength={field === 'label' ? 40 : field === 'headline' ? 180 : 240} onChange={e => editScene({ text: { ...scene.text, [field]: e.target.value } })} /></label>)}
      {num('Font size', scene.text.fontSize, 40, 80, 1, v => editScene({ text: { ...scene.text, fontSize: v } }))}{num('Text X', scene.text.x, .09, .7, .01, v => editScene({ text: { ...scene.text, x: v } }))}{num('Text Y', scene.text.y, .12, .72, .01, v => editScene({ text: { ...scene.text, y: v } }))}{num('Text width', scene.text.width, .2, .77, .01, v => editScene({ text: { ...scene.text, width: v } }))}
      <label>Alignment<select value={scene.text.align} onChange={e => editScene({ text: { ...scene.text, align: e.target.value } })}>{['left', 'center', 'right'].map(a => <option key={a}>{a}</option>)}</select></label>
      <label>Text color<input type="color" value={scene.text.color} onChange={e => editScene({ text: { ...scene.text, color: e.target.value } })} /></label><label>Backplate color<input type="color" value={scene.text.background} onChange={e => editScene({ text: { ...scene.text, background: e.target.value } })} /></label>
      <label className="editor-check"><input type="checkbox" checked={scene.text.backplate} onChange={e => editScene({ text: { ...scene.text, backplate: e.target.checked } })} />Text backplate</label>
      {num('Text appears (frame)', scene.text.appear, 0, scene.frames - 1, 1, v => editScene({ text: { ...scene.text, appear: v } }))}{num('Text disappears (frame)', scene.text.disappear, scene.text.appear + 1, scene.frames + 30, 1, v => editScene({ text: { ...scene.text, disappear: v } }))}
      <label>Transition<select value={scene.transition.kind} onChange={e => editScene({ transition: { kind: e.target.value, frames: e.target.value === 'cut' ? 0 : 15 } })}>{['cut', 'crossfade', 'fade_black'].map(t => <option key={t}>{t}</option>)}</select></label>
      {scene.transition.kind !== 'cut' && num('Transition frames', scene.transition.frames, 1, 30, 1, v => editScene({ transition: { ...scene.transition, frames: v } }))}
    </>}</aside></div>
    <details><summary>Company branding & separate Facebook caption</summary><label className="editor-check"><input type="checkbox" checked={draft.brand.enabled} disabled={!brand.displayName} onChange={e => change({ ...draft, brand: { ...draft.brand, enabled: e.target.checked, displayName: brand.displayName } })} />Company end card: {brand.displayName || 'No approved public brand available'}</label>
      <label className="editor-check"><input type="checkbox" disabled={!brand.logoAvailable} checked={draft.brand.logo} onChange={e => change({ ...draft, brand: { ...draft.brand, logo: e.target.checked } })} />Approved logo</label>
      <label>Approved CTA<select value={draft.brand.cta} onChange={e => change({ ...draft, brand: { ...draft.brand, cta: e.target.value } })}><option value="">None</option>{brand.allowedCtas.map(c => <option key={c}>{c}</option>)}</select></label>
      {num('End card duration', draft.brand.frames / 30, 1, 5, 1 / 30, v => change({ ...draft, brand: { ...draft.brand, frames: Math.round(v * 30) } }))}
      <label>Facebook caption (does not change MP4)<textarea maxLength={2000} value={draft.caption} onChange={e => change({ ...draft, caption: e.target.value })} /></label>
    </details><p>Photo-only editor. Video trim, licensed audio, voice and subtitles are not enabled in this version.</p>
    {publicationReview && companyId && approval && video && renderId && <Suspense fallback={<p>Loading separate publication review…</p>}><FacebookReelPublishPanel companyId={companyId} jobId={jobId} renderJobId={renderId} videoUrl={video} canPublish initialCaption={draft.caption} /></Suspense>}
  </section>;
}
