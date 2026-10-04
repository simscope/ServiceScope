import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Film, RefreshCw, X } from 'lucide-react';
import { loadFacebookPublishingStatus, publishFacebookReel, reconcileFacebookReel } from '../../features/meta-publishing/clientApi';
import { normalizeFacebookPublishingMessage, normalizePublishingError } from '../../features/meta-publishing/contracts';
import type { FacebookReelPublishResult } from '../../features/meta-publishing/contracts';
import {
  canPrepareFreshFacebookReel,
  facebookActiveReelPublication,
  facebookHistoricalReelPublication,
  facebookReelFailureMessage,
} from '../../features/meta-publishing/workspaceState';

type FacebookReelPublishPanelProps = {
  companyId: string;
  jobId: string;
  renderJobId: string;
  videoUrl: string;
  coverUrl?: string | null;
  canPublish: boolean;
  initialCaption?: string;
};

export function FacebookReelPublishPanel({ companyId, jobId, renderJobId, videoUrl, coverUrl, canPublish, initialCaption = '' }: FacebookReelPublishPanelProps) {
  const [open, setOpen] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<FacebookReelPublishResult | null>(null);
  const [history, setHistory] = useState<FacebookReelPublishResult | null>(null);
  const [activePublication, setActivePublication] = useState<FacebookReelPublishResult | null>(null);
  const [publishingReady, setPublishingReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [facebookPageName, setFacebookPageName] = useState<string | null>(null);
  const [captionDraft, setCaptionDraft] = useState(initialCaption);
  const [reviewedCaption, setReviewedCaption] = useState('');
  const idempotencyKey = useRef<string | null>(null);

  useEffect(() => {
    if (!canPublish) return;
    let active = true;
    loadFacebookPublishingStatus(companyId, jobId).then((snapshot) => {
      if (!active) return;
      setFacebookPageName(snapshot.facebookPageName);
      setPublishingReady(snapshot.configured && snapshot.connected && snapshot.facebookPublishingEnabled && Boolean(snapshot.facebookPageName));
      const historicalPublication = facebookHistoricalReelPublication(snapshot, renderJobId);
      const currentPublication = facebookActiveReelPublication(snapshot, renderJobId);
      setHistory(historicalPublication ? asReelResult(historicalPublication) : null);
      setActivePublication(currentPublication ? asReelResult(currentPublication) : null);
    }).catch(() => {});
    return () => { active = false; };
  }, [canPublish, companyId, jobId, renderJobId]);

  useEffect(() => {
    idempotencyKey.current = null;
    setOpen(false);
    setConfirmed(false);
    setResult(null);
    setHistory(null);
    setActivePublication(null);
    setPublishingReady(false);
    setFacebookPageName(null);
    setCaptionDraft(initialCaption);
    setReviewedCaption('');
  }, [companyId, jobId, renderJobId]);

  function openReview() {
    idempotencyKey.current = crypto.randomUUID();
    setReviewedCaption(captionDraft);
    setConfirmed(false);
    setError(null);
    setOpen(true);
  }

  function updateReviewedCaption(value: string) {
    setReviewedCaption(value);
    setCaptionDraft(value);
    setConfirmed(false);
    setError(null);
  }

  function updateConfirmation(approved: boolean) {
    if (!approved) {
      setConfirmed(false);
      return;
    }
    try {
      const normalized = normalizeFacebookPublishingMessage(reviewedCaption);
      setReviewedCaption(normalized);
      setCaptionDraft(normalized);
      setConfirmed(true);
      setError(null);
    } catch (nextError) {
      setConfirmed(false);
      setError(normalizePublishingError(nextError));
    }
  }

  async function confirmPublish() {
    if (!confirmed || busy || !idempotencyKey.current) return;
    const normalizedCaption = normalizeFacebookPublishingMessage(reviewedCaption);
    if (normalizedCaption !== reviewedCaption) {
      setReviewedCaption(normalizedCaption);
      setConfirmed(false);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const next = await publishFacebookReel({
        companyId,
        jobId,
        renderJobId,
        message: normalizedCaption,
        idempotencyKey: idempotencyKey.current,
        explicitApproval: true,
      });
      setResult(next);
      setOpen(false);
    } catch (nextError) {
      setError(normalizePublishingError(nextError));
    } finally {
      setBusy(false);
    }
  }

  async function refreshStatus() {
    const publication = result ?? activePublication;
    if (!publication?.publicationId || busy) return;
    setBusy(true);
    setError(null);
    try {
      setResult(await reconcileFacebookReel({ companyId, publicationId: publication.publicationId, explicitApproval: true }));
    } catch (nextError) {
      setError(normalizePublishingError(nextError));
    } finally {
      setBusy(false);
    }
  }

  const resultIsActive = result && ['publishing', 'delivery_unknown'].includes(result.status);
  const currentPublication = result ? (resultIsActive ? result : null) : activePublication;
  const historicalPublication = result && !resultIsActive ? result : history;
  const historicalFailure = historicalPublication?.status === 'failed'
    ? facebookReelFailureMessage(historicalPublication)
    : '';
  const canPrepare = canPublish && publishingReady
    && canPrepareFreshFacebookReel(historicalPublication, currentPublication);

  return (
    <div className="ai-reel-facebook-publish">
      {historicalFailure ? (
        <div className="ai-reel-publication-history">
          <strong>Previous attempt</strong>
          <span className="ai-reel-approval-note">{historicalFailure}</span>
        </div>
      ) : null}
      {!canPublish ? (
        <span className="ai-reel-approval-note">Facebook Reel publishing requires an Admin or Manager.</span>
      ) : historicalPublication?.status === 'published' ? (
        <span className="ai-reel-facebook-result"><CheckCircle2 size={17} aria-hidden="true" />Published to Facebook</span>
      ) : currentPublication?.providerStage === 'provider_processing' || currentPublication?.status === 'delivery_unknown' ? (
        <button className="secondary-button" type="button" onClick={refreshStatus} disabled={busy}>
          <RefreshCw size={17} aria-hidden="true" />{busy ? 'Checking' : 'Check Facebook status'}
        </button>
      ) : currentPublication?.status === 'publishing' ? (
        <span className="ai-reel-approval-note">Facebook Reel delivery is in progress.</span>
      ) : canPrepare ? (
        <button className="primary-button" type="button" onClick={openReview}>
          <Film size={17} aria-hidden="true" />Prepare new Reel publication
        </button>
      ) : null}
      {error ? <span className="ai-reel-approval-note">{error}</span> : null}

      {open ? (
        <div className="facebook-publish-modal-backdrop" role="presentation">
          <section className="facebook-publish-modal" role="dialog" aria-modal="true" aria-labelledby="facebook-reel-publish-title">
            <header>
              <div>
                <h3 id="facebook-reel-publish-title">Publish Facebook Reel</h3>
                <span>Facebook Page: {facebookPageName ?? 'Connected Page'} · Public audience · Publish now</span>
              </div>
              <button className="icon-button" type="button" aria-label="Close Reel publishing review" onClick={() => setOpen(false)}>
                <X size={18} aria-hidden="true" />
              </button>
            </header>
            <video controls preload="metadata" poster={coverUrl ?? undefined} src={videoUrl} />
            <label className="facebook-reel-caption-field">
              <span>Facebook caption</span>
              <textarea value={reviewedCaption} onChange={(event) => updateReviewedCaption(event.target.value)} rows={5} maxLength={5000} />
              <small>{Array.from(reviewedCaption).length}/5000</small>
            </label>
            <label className="facebook-publish-approval">
              <input type="checkbox" checked={confirmed} onChange={(event) => updateConfirmation(event.target.checked)} />
              Publish this exact completed video and caption to the connected Facebook Page.
            </label>
            <footer>
              <button className="secondary-button" type="button" onClick={() => setOpen(false)}>Cancel</button>
              <button className="primary-button" type="button" onClick={confirmPublish} disabled={!confirmed || busy}>
                <Film size={17} aria-hidden="true" />{busy ? 'Publishing' : 'Confirm and publish'}
              </button>
            </footer>
          </section>
        </div>
      ) : null}
    </div>
  );
}

function asReelResult(publication: NonNullable<ReturnType<typeof facebookHistoricalReelPublication>>): FacebookReelPublishResult {
  return {
    ...publication,
    ok: publication.status === 'published' || publication.status === 'publishing',
    publicationId: publication.publicationId ?? null,
    publicationKind: 'reel_video',
    providerStage: publication.providerStage ?? null,
  };
}
