import { useEffect, useMemo, useRef, useState } from 'react';
import { Pause, Play, RotateCcw } from 'lucide-react';
import type { ReelCreativePlanV1, ReelSceneV1 } from '../../features/reel-director/contracts';

type ReelPreviewProps = {
  plan: ReelCreativePlanV1;
  mediaUrls: Map<string, { url: string; alt: string }>;
};

export function ReelPreview({ plan, mediaUrls }: ReelPreviewProps) {
  const timeline = useMemo(() => buildTimeline(plan), [plan]);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const frameRef = useRef<number>();
  const previousTimeRef = useRef<number>();

  useEffect(() => {
    setElapsedMs(0);
    setPlaying(false);
    previousTimeRef.current = undefined;
  }, [plan.revision]);

  useEffect(() => {
    if (!playing) {
      previousTimeRef.current = undefined;
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
      return;
    }
    const tick = (time: number) => {
      const previous = previousTimeRef.current ?? time;
      previousTimeRef.current = time;
      setElapsedMs((current) => {
        const next = current + Math.min(100, time - previous);
        if (next >= timeline.totalDurationMs) {
          setPlaying(false);
          return timeline.totalDurationMs;
        }
        return next;
      });
      frameRef.current = requestAnimationFrame(tick);
    };
    frameRef.current = requestAnimationFrame(tick);
    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    };
  }, [playing, timeline.totalDurationMs]);

  const active = activeTimelineItem(timeline.items, elapsedMs);
  const progress = timeline.totalDurationMs ? Math.min(100, (elapsedMs / timeline.totalDurationMs) * 100) : 0;
  const scene = active?.kind === 'scene' ? active.scene : undefined;
  const asset = scene ? mediaUrls.get(scene.attachmentId) : undefined;

  function play() {
    if (elapsedMs >= timeline.totalDurationMs) setElapsedMs(0);
    setPlaying(true);
  }

  function restart() {
    setElapsedMs(0);
    previousTimeRef.current = undefined;
    setPlaying(true);
  }

  return (
    <section className="reel-preview-shell" aria-label="AI Reel preview">
      <div className="reel-preview-stage" data-testid="reel-preview-9x16">
        {scene && asset ? (
          <div key={`${plan.revision}:${scene.id}`} className={`reel-preview-media-frame transition-${scene.transitionOut}`}>
            <img
              className={`reel-preview-media motion-${scene.motionPreset} crop-${scene.cropStrategy}`}
              style={{ animationDuration: `${scene.durationMs}ms` }}
              src={asset.url}
              alt={asset.alt}
            />
          </div>
        ) : null}
        {scene && elapsedMs === 0 && !playing ? (
          <div className="reel-preview-cover-title"><span>Cover</span><strong>{plan.cover.title}</strong></div>
        ) : null}
        {active?.kind === 'brand' ? (
          <div className="reel-preview-brand-frame">
            <strong>{plan.brand.displayName}</strong>
            <span>{plan.brand.cta}</span>
          </div>
        ) : null}
        {scene ? (
          <div className="reel-preview-safe-zone">
            <span className="reel-preview-role">{sceneRoleLabel(scene.sceneRole)}</span>
            <div className="reel-preview-copy">
              <strong>{scene.overlayText}</strong>
              {scene.secondaryText ? <span>{scene.secondaryText}</span> : null}
            </div>
          </div>
        ) : null}
        {!scene && active?.kind !== 'brand' ? (
          <div className="reel-preview-empty-frame">Preview unavailable</div>
        ) : null}
        <div className="reel-preview-progress" aria-hidden="true">
          <span style={{ width: `${progress}%` }} />
        </div>
      </div>
      <div className="reel-preview-controls">
        <button type="button" className="icon-button" onClick={playing ? () => setPlaying(false) : play} aria-label={playing ? 'Pause Reel preview' : 'Play Reel preview'} title={playing ? 'Pause' : 'Play'}>
          {playing ? <Pause size={18} aria-hidden="true" /> : <Play size={18} aria-hidden="true" />}
        </button>
        <button type="button" className="icon-button" onClick={restart} aria-label="Restart Reel preview" title="Restart">
          <RotateCcw size={18} aria-hidden="true" />
        </button>
        <span>{Math.round(elapsedMs / 1000)}s / {Math.round(timeline.totalDurationMs / 1000)}s</span>
      </div>
    </section>
  );
}

type TimelineItem =
  | { kind: 'scene'; startMs: number; endMs: number; scene: ReelSceneV1 }
  | { kind: 'brand'; startMs: number; endMs: number };

function buildTimeline(plan: ReelCreativePlanV1) {
  const items: TimelineItem[] = [];
  let cursor = 0;
  for (const scene of plan.scenes) {
    items.push({ kind: 'scene', startMs: cursor, endMs: cursor + scene.durationMs, scene });
    cursor += scene.durationMs;
  }
  if (plan.brand.enabled) {
    items.push({ kind: 'brand', startMs: cursor, endMs: cursor + plan.brand.durationMs });
    cursor += plan.brand.durationMs;
  }
  return { items, totalDurationMs: cursor };
}

function activeTimelineItem(items: TimelineItem[], elapsedMs: number) {
  return items.find((item) => elapsedMs >= item.startMs && elapsedMs < item.endMs) ?? items[items.length - 1];
}

function sceneRoleLabel(role: ReelSceneV1['sceneRole']) {
  if (role === 'repair_process') return 'Process';
  if (role === 'replacement_part') return 'Part';
  if (role === 'finished_result') return 'Result';
  if (role === 'supporting_image') return 'Context';
  return role.charAt(0).toUpperCase() + role.slice(1);
}
