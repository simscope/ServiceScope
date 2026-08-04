import { useEffect, useState } from 'react';
import { Facebook, Image, Send, ShieldCheck, X } from 'lucide-react';
import { loadFacebookPublishingStatus, publishFacebookSinglePhoto, publishFacebookText } from '../../features/meta-publishing/clientApi';
import {
  FACEBOOK_PUBLISH_ERROR_MESSAGES,
  facebookPublishingCharacterCount,
  normalizeFacebookPublishingMessage,
  normalizePublishingError,
  publishingErrorCode,
  type FacebookPublishingSnapshot,
} from '../../features/meta-publishing/contracts';
import {
  beginFacebookPublishSubmission,
  emptyFacebookPublishWorkspace,
  facebookPublicationInProgress,
  facebookPublicationNeedsPageCheck,
  invalidateFacebookPublishApproval,
  openFacebookPublishConfirmation,
  resetFacebookPublishWorkspace,
} from '../../features/meta-publishing/workspaceState';

type FacebookPublishPanelProps = {
  companyId: string;
  jobId: string;
  jobStatus: string;
  message: string;
  selectedMediaCount: number;
  approvedPhotos?: Array<{ id: string; name: string; dataUrl?: string; label?: string; mimeType: string }>;
  privacyStatus: string;
};

export function FacebookPublishPanel({ companyId, jobId, jobStatus, message, selectedMediaCount, approvedPhotos = [], privacyStatus }: FacebookPublishPanelProps) {
  const [snapshot, setSnapshot] = useState<FacebookPublishingSnapshot | null>(null);
  const [statusError, setStatusError] = useState('');
  const [workspace, setWorkspace] = useState(emptyFacebookPublishWorkspace);
  const [mode, setMode] = useState<'text_only' | 'single_photo'>('text_only');
  const [selectedAttachmentId, setSelectedAttachmentId] = useState('');

  useEffect(() => {
    let active = true;
    setSnapshot(null);
    setStatusError('');
    setWorkspace(resetFacebookPublishWorkspace());
    loadFacebookPublishingStatus(companyId, jobId)
      .then((value) => { if (active) setSnapshot(value); })
      .catch(() => { if (active) setStatusError('Publishing status is unavailable.'); });
    return () => { active = false; };
  }, [companyId, jobId]);

  useEffect(() => {
    setWorkspace((current) => invalidateFacebookPublishApproval(current, message, mode, mode === 'single_photo' ? selectedAttachmentId || null : null));
  }, [message, mode, selectedAttachmentId]);

  function openConfirmation() {
    let finalMessage = '';
    try {
      finalMessage = normalizeFacebookPublishingMessage(message);
    } catch {
      return;
    }
    if (
      !snapshot?.facebookPublishingEnabled
      || !['Completed', 'Warranty'].includes(jobStatus)
      || (mode === 'single_photo' && !selectedAttachmentId)
      || snapshot.lastPublication?.status === 'publishing'
      || (snapshot.lastPublication?.status === 'delivery_unknown' && !workspace.pageCheckAcknowledged)
    ) return;
    setWorkspace(openFacebookPublishConfirmation(
      finalMessage,
      crypto.randomUUID(),
      mode,
      mode === 'single_photo' ? selectedAttachmentId : null,
    ));
  }

  async function publishNow() {
    const begun = beginFacebookPublishSubmission(workspace);
    setWorkspace(begun.state);
    if (!begun.shouldSubmit || !begun.state.idempotencyKey) return;
    try {
      const common = {
        companyId,
        jobId,
        message: begun.state.approvedMessage,
        idempotencyKey: begun.state.idempotencyKey,
        explicitApproval: true as const,
      };
      const result = begun.state.mode === 'single_photo'
        ? await publishFacebookSinglePhoto({ ...common, attachmentId: begun.state.approvedAttachmentId ?? '' })
        : await publishFacebookText(common);
      setWorkspace((current) => ({ ...current, confirmationOpen: false, submitting: false, result, error: '' }));
      setSnapshot((current) => current ? { ...current, lastPublication: result } : current);
    } catch (error) {
      const errorCode = publishingErrorCode(error);
      if (errorCode === 'META_PUBLICATION_DELIVERY_UNKNOWN') {
        try {
          const refreshed = await loadFacebookPublishingStatus(companyId, jobId);
          setSnapshot(refreshed);
        } catch {
          // Keep the action blocked unless a durable state can be confirmed.
        }
      }
      setWorkspace((current) => ({
        ...current,
        confirmationOpen: false,
        submitting: false,
        result: null,
        error: normalizePublishingError(error),
        errorCode,
      }));
    }
  }

  const pageName = snapshot?.facebookPageName ?? 'Facebook Page';
  let normalizedMessage = '';
  try {
    normalizedMessage = normalizeFacebookPublishingMessage(message);
  } catch {}
  const durablePublication = workspace.result ?? snapshot?.lastPublication ?? null;
  const publicationInProgress = facebookPublicationInProgress(durablePublication);
  const deliveryUnknown = !publicationInProgress
    && facebookPublicationNeedsPageCheck(durablePublication, workspace.errorCode);
  const durableUnknownConfirmed = durablePublication?.status === 'delivery_unknown';
  const unsupportedJob = !['Completed', 'Warranty'].includes(jobStatus);
  const selectedPhoto = approvedPhotos.find((photo) => photo.id === selectedAttachmentId) ?? null;
  const publishDisabled = !snapshot?.configured
    || !snapshot.facebookPublishingEnabled
    || !normalizedMessage
    || unsupportedJob
    || (mode === 'single_photo' && !selectedPhoto)
    || publicationInProgress
    || (deliveryUnknown && (!durableUnknownConfirmed || !workspace.pageCheckAcknowledged))
    || workspace.submitting;

  return (
    <section className="facebook-publish-panel" aria-label="Facebook Page publishing">
      <div className="facebook-publish-heading">
        <Facebook size={18} aria-hidden="true" />
        <div>
          <strong>{snapshot?.connected ? `Facebook Page connected: ${pageName}` : 'Facebook Page not connected'}</strong>
          {!snapshot ? <span>{statusError || 'Checking publishing access...'}</span> : null}
          {snapshot && !snapshot.configured ? <span>Facebook Page publishing is not configured for this environment.</span> : null}
          {snapshot?.connected && !snapshot.facebookPublishingEnabled ? (
            <span>Publishing permission is not enabled. Reconnect Meta to add Facebook Page publishing access.</span>
          ) : null}
        </div>
      </div>

      <div className="facebook-publish-mode" role="group" aria-label="Facebook publish mode">
        <button type="button" className={mode === 'text_only' ? 'active' : ''} onClick={() => setMode('text_only')}>
          Text only
        </button>
        <button type="button" className={mode === 'single_photo' ? 'active' : ''} onClick={() => setMode('single_photo')}>
          <Image size={15} aria-hidden="true" />
          Single photo
        </button>
      </div>
      {mode === 'text_only' ? <p>Text-only - selected photos and videos will not be uploaded.</p> : null}
      {mode === 'single_photo' ? (
        <div className="facebook-photo-picker">
          <p>Exactly one approved selected photo will be uploaded to Facebook Page {pageName}.</p>
          {approvedPhotos.length ? approvedPhotos.map((photo) => (
            <label className="facebook-photo-option" key={photo.id}>
              <input
                type="radio"
                name="facebook-single-photo"
                checked={selectedAttachmentId === photo.id}
                onChange={() => setSelectedAttachmentId(photo.id)}
              />
              {photo.dataUrl ? <img src={photo.dataUrl} alt={photo.label || photo.name} /> : <span className="facebook-photo-thumb">Photo</span>}
              <span>{photo.label || photo.name || 'Approved photo'}</span>
            </label>
          )) : <p className="facebook-publish-result error">Approve one analyzed selected photo before publishing with a photo.</p>}
        </div>
      ) : null}
      {unsupportedJob ? (
        <p className="facebook-publish-result error">Facebook publishing is available only for Completed and Warranty jobs.</p>
      ) : null}
      {publicationInProgress ? (
        <p className="facebook-publish-result error">A Facebook publication for this job is already in progress.</p>
      ) : null}
      {deliveryUnknown ? (
        <div className="facebook-publish-result error">
          <p>Facebook did not confirm whether the post was published.</p>
          <p>Check the Facebook Page before creating another publication.</p>
          {durableUnknownConfirmed ? <label className="facebook-publish-approval">
            <input
              type="checkbox"
              checked={workspace.pageCheckAcknowledged}
              onChange={(event) => setWorkspace((current) => ({ ...current, pageCheckAcknowledged: event.target.checked }))}
            />
            <span>I checked the Facebook Page and understand that continuing will create a new publication.</span>
          </label> : null}
        </div>
      ) : null}
      {durablePublication?.status === 'failed' && !workspace.error ? (
        <p className="facebook-publish-result error">
          {durablePublication.errorCode
            ? FACEBOOK_PUBLISH_ERROR_MESSAGES[durablePublication.errorCode] ?? 'The latest Facebook publication failed.'
            : 'The latest Facebook publication failed.'}
        </p>
      ) : null}
      {durablePublication?.status === 'published' && durablePublication.publishedAt ? (
        <p className="facebook-publish-result success">Latest Facebook publication completed at {new Date(durablePublication.publishedAt).toLocaleString()}.</p>
      ) : null}
      <button className="primary-button" type="button" onClick={openConfirmation} disabled={publishDisabled}>
        <Send size={16} aria-hidden="true" />
        Review and publish
      </button>

      {workspace.error ? <p className="facebook-publish-result error">{workspace.error}</p> : null}

      {workspace.confirmationOpen ? (
        <div className="facebook-publish-modal-backdrop" role="presentation">
          <section className="facebook-publish-modal" role="dialog" aria-modal="true" aria-labelledby="facebook-publish-title">
            <header>
              <div>
                <h3 id="facebook-publish-title">Publish to Facebook Page {pageName}</h3>
                <span>{facebookPublishingCharacterCount(workspace.approvedMessage)} characters</span>
              </div>
              <button className="icon-button" type="button" title="Close" onClick={() => setWorkspace(emptyFacebookPublishWorkspace)} disabled={workspace.submitting}>
                <X size={18} aria-hidden="true" />
              </button>
            </header>
            <div className="facebook-publish-preview">{workspace.approvedMessage}</div>
            {workspace.mode === 'single_photo' && selectedPhoto ? (
              <div className="facebook-publish-photo-review">
                {selectedPhoto.dataUrl ? <img src={selectedPhoto.dataUrl} alt={selectedPhoto.label || selectedPhoto.name} /> : null}
                <span>{selectedPhoto.label || selectedPhoto.name || 'Approved photo'}</span>
              </div>
            ) : null}
            <div className="facebook-publish-review-status">
              <ShieldCheck size={18} aria-hidden="true" />
              <span>{privacyStatus}</span>
            </div>
            {workspace.mode === 'single_photo'
              ? <p>Facebook will receive exactly one approved photo with the exact text above.</p>
              : <p>Text-only - {selectedMediaCount ? `${selectedMediaCount} selected media item${selectedMediaCount === 1 ? '' : 's'} will` : 'selected media will'} not be uploaded.</p>}
            <label className="facebook-publish-approval">
              <input
                type="checkbox"
                checked={workspace.approved}
                onChange={(event) => setWorkspace((current) => ({ ...current, approved: event.target.checked }))}
                disabled={workspace.submitting}
              />
              <span>I reviewed the exact final text and approve publishing it to the Facebook Page now.</span>
            </label>
            <footer>
              <button className="secondary-button" type="button" onClick={() => setWorkspace(emptyFacebookPublishWorkspace)} disabled={workspace.submitting}>Cancel</button>
              <button className="primary-button" type="button" onClick={publishNow} disabled={!workspace.approved || workspace.submitting}>
                <Send size={16} aria-hidden="true" />
                {workspace.submitting ? 'Publishing...' : 'Publish now'}
              </button>
            </footer>
          </section>
        </div>
      ) : null}
    </section>
  );
}
