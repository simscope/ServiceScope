import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Film, RefreshCw, X } from 'lucide-react';
import { loadFacebookPublishingStatus, publishFacebookReel, reconcileFacebookReel } from '../../features/meta-publishing/clientApi';
import { normalizeFacebookPublishingMessage, normalizePublishingError } from '../../features/meta-publishing/contracts';
import type { FacebookReelPublishResult } from '../../features/meta-publishing/contracts';

type FacebookReelPublishPanelProps = {
  companyId: string;
  jobId: string;
  renderJobId: string;
  caption: string;
  videoUrl: string;
  coverUrl?: string | null;
};

export function FacebookReelPublishPanel({ companyId, jobId, renderJobId, caption, videoUrl, coverUrl }: FacebookReelPublishPanelProps) {
  const [open, setOpen] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<FacebookReelPublishResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reviewedCaption, setReviewedCaption] = useState('');
  const idempotencyKey = useRef<string | null>(null);

  useEffect(() => {
    let active = true;
    loadFacebookPublishingStatus(companyId, jobId).then((snapshot) => {
      const publication = snapshot.lastPublication;
      if (!active || publication?.publicationKind !== 'reel_video' || publication.renderJobId !== renderJobId) return;
      setResult({
        ...publication,
        ok: publication.status === 'published' || publication.status === 'publishing',
        publicationId: publication.publicationId ?? null,
        publicationKind: 'reel_video',
        providerStage: publication.providerStage ?? null,
      });
    }).catch(() => {});
    return () => { active = false; };
  }, [companyId, jobId, renderJobId]);

  useEffect(() => {
    idempotencyKey.current = null;
    setOpen(false);
    setConfirmed(false);
    setReviewedCaption('');
  }, [companyId, jobId, renderJobId, caption]);

  function openReview() {
    try {
      const snapshot = normalizeFacebookPublishingMessage(caption);
      idempotencyKey.current ??= crypto.randomUUID();
      setReviewedCaption(snapshot);
      setConfirmed(false);
      setError(null);
      setOpen(true);
    } catch (nextError) {
      setError(normalizePublishingError(nextError));
    }
  }

  async function confirmPublish() {
    if (!confirmed || busy || !idempotencyKey.current) return;
    setBusy(true);
    setError(null);
    try {
      const next = await publishFacebookReel({
        companyId,
        jobId,
        renderJobId,
        message: reviewedCaption,
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
    if (!result?.publicationId || busy) return;
    setBusy(true);
    setError(null);
    try {
      setResult(await reconcileFacebookReel({ companyId, publicationId: result.publicationId, explicitApproval: true }));
    } catch (nextError) {
      setError(normalizePublishingError(nextError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ai-reel-facebook-publish">
      {result?.status === 'published' ? (
        <span className="ai-reel-facebook-result"><CheckCircle2 size={17} aria-hidden="true" />Published to Facebook</span>
      ) : result?.providerStage === 'provider_processing' || result?.status === 'delivery_unknown' ? (
        <button className="secondary-button" type="button" onClick={refreshStatus} disabled={busy}>
          <RefreshCw size={17} aria-hidden="true" />{busy ? 'Checking' : 'Check Facebook status'}
        </button>
      ) : result?.status === 'publishing' ? (
        <span className="ai-reel-approval-note">Facebook Reel delivery is in progress.</span>
      ) : result?.status === 'failed' ? (
        <span className="ai-reel-approval-note">Facebook rejected this Reel publication.</span>
      ) : (
        <button className="primary-button" type="button" onClick={openReview}>
          <Film size={17} aria-hidden="true" />Publish Reel
        </button>
      )}
      {error ? <span className="ai-reel-approval-note">{error}</span> : null}

      {open ? (
        <div className="facebook-publish-modal-backdrop" role="presentation">
          <section className="facebook-publish-modal" role="dialog" aria-modal="true" aria-labelledby="facebook-reel-publish-title">
            <header>
              <div>
                <h3 id="facebook-reel-publish-title">Publish Facebook Reel</h3>
                <span>Public audience</span>
              </div>
              <button className="icon-button" type="button" aria-label="Close Reel publishing review" onClick={() => setOpen(false)}>
                <X size={18} aria-hidden="true" />
              </button>
            </header>
            <video controls preload="metadata" poster={coverUrl ?? undefined} src={videoUrl} />
            <div className="facebook-publish-preview">{reviewedCaption}</div>
            <label className="facebook-publish-approval">
              <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
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
