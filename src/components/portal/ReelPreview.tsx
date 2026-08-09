import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Pause, Play, RotateCcw } from 'lucide-react';
import type { ReelCreativePlanV1 } from '../../features/reel-director/contracts';
import { activeReelFrame, buildReelTimeline, reelMotionFrame, reelPresentationSpec } from '../../features/reel-director/presentationSpec.js';

type ReelPreviewProps = {
  plan: ReelCreativePlanV1;
  mediaUrls: Map<string, { url: string; alt: string }>;
};

export function ReelPreview({ plan, mediaUrls }: ReelPreviewProps) {
  const timeline = useMemo(() => buildReelTimeline(plan), [plan]);
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

  const frame = activeReelFrame(timeline, elapsedMs);
  const active = frame.item;
  const progress = timeline.totalDurationMs ? Math.min(100, (elapsedMs / timeline.totalDurationMs) * 100) : 0;
  const scene = active?.kind === 'scene' ? active.scene : undefined;
  const asset = scene ? mediaUrls.get(scene.attachmentId) : undefined;
  const sceneProgress = scene ? Math.min(1, frame.elapsedInItemMs / scene.durationMs) : 0;
  const motion = scene ? reelMotionFrame(scene.motionPreset, scene.cropStrategy, sceneProgress) : undefined;
  const nextScene = frame.transition?.nextItem?.kind === 'scene' ? frame.transition.nextItem.scene : undefined;
  const nextAsset = nextScene ? mediaUrls.get(nextScene.attachmentId) : undefined;
  const nextMotion = nextScene ? reelMotionFrame(nextScene.motionPreset, nextScene.cropStrategy, 0) : undefined;
  const nextBrand = frame.transition?.nextItem?.kind === 'brand';
  const transitionProgress = frame.transition?.progress ?? 0;
  const currentOpacity = frame.transition?.kind === 'quick_fade' ? Math.max(0, 1 - transitionProgress * 2) : 1;
  const nextOpacity = frame.transition?.kind === 'quick_fade' ? Math.max(0, transitionProgress * 2 - 1) : transitionProgress;
  const textOpacity = Math.min(1, frame.elapsedInItemMs / reelPresentationSpec.textFadeMs);
  const outgoingTextOpacity = frame.transition?.kind === 'quick_fade'
    ? currentOpacity
    : frame.transition ? 1 - transitionProgress : 1;

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
      <div className="reel-preview-stage" data-testid="reel-preview-9x16" style={{ aspectRatio: `${reelPresentationSpec.width} / ${reelPresentationSpec.height}` }}>
        {scene && asset ? (
          <div key={`${plan.revision}:${scene.id}`} className="reel-preview-media-frame" style={{ opacity: currentOpacity }}>
            <img
              className="reel-preview-media"
              style={{ transform: `translate(${(motion?.x ?? 0) * 100}%, ${(motion?.y ?? 0) * 100}%) scale(${motion?.scale ?? 1})` }}
              src={asset.url}
              alt={asset.alt}
            />
          </div>
        ) : null}
        {nextScene && nextAsset && frame.transition ? (
          <div className="reel-preview-media-frame reel-preview-transition-next" style={{ opacity: nextOpacity }}>
            <img className="reel-preview-media" style={{ transform: `translate(${(nextMotion?.x ?? 0) * 100}%, ${(nextMotion?.y ?? 0) * 100}%) scale(${nextMotion?.scale ?? 1})` }} src={nextAsset.url} alt={nextAsset.alt} />
          </div>
        ) : null}
        {nextBrand && frame.transition ? (
          <div className="reel-preview-brand-frame reel-preview-transition-next" style={{ ...reelPreviewBrandFrameStyle(), opacity: nextOpacity }}>
            <strong style={reelPreviewTextStyle('brandDisplayName')}>{plan.brand.displayName}</strong>
            <span style={reelPreviewTextStyle('brandCta')}>{plan.brand.cta}</span>
          </div>
        ) : null}
        {active?.kind === 'brand' ? (
          <div className="reel-preview-brand-frame" style={reelPreviewBrandFrameStyle()}>
            <strong style={reelPreviewTextStyle('brandDisplayName')}>{plan.brand.displayName}</strong>
            <span style={reelPreviewTextStyle('brandCta')}>{plan.brand.cta}</span>
          </div>
        ) : null}
        {scene ? (
          <div className="reel-preview-safe-zone" style={{
            top: `${reelPresentationSpec.safeZone.top * 100}%`,
            right: `${reelPresentationSpec.safeZone.right * 100}%`,
            bottom: `${reelPresentationSpec.safeZone.bottom * 100}%`,
            left: `${reelPresentationSpec.safeZone.left * 100}%`,
            opacity: textOpacity * outgoingTextOpacity,
            transform: `translateY(${(1 - textOpacity) * 10}px)`,
          }}>
            <div className="reel-preview-copy">
              <strong style={reelPreviewTextStyle('scenePrimary')}>{scene.overlayText}</strong>
              {scene.secondaryText ? <span style={reelPreviewTextStyle('sceneSecondary')}>{scene.secondaryText}</span> : null}
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

function reelPreviewBrandFrameStyle(): CSSProperties {
  const { top, right, bottom, left } = reelPresentationSpec.safeZone;
  return { padding: `${top * 100}% ${right * 100}% ${bottom * 100}% ${left * 100}%` };
}

function reelPreviewTextStyle(styleName: 'scenePrimary' | 'sceneSecondary' | 'brandDisplayName' | 'brandCta'): CSSProperties {
  const style = reelPresentationSpec.text[styleName];
  return {
    maxWidth: `${style.widthRatio * 100}%`,
    fontFamily: reelPresentationSpec.text.fontFamily,
    fontSize: `${style.maxFontSize / 10.8}cqw`,
    lineHeight: style.lineHeightRatio,
    display: '-webkit-box',
    WebkitBoxOrient: 'vertical',
    WebkitLineClamp: style.maxLines,
    overflow: 'hidden',
    overflowWrap: 'anywhere',
  };
}
