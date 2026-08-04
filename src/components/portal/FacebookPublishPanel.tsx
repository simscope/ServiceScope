import { useEffect, useState } from 'react';
import { Facebook, Send, ShieldCheck, X } from 'lucide-react';
import { loadFacebookPublishingStatus, publishFacebookText } from '../../features/meta-publishing/clientApi';
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
  privacyStatus: string;
};

export function FacebookPublishPanel({ companyId, jobId, jobStatus, message, selectedMediaCount, privacyStatus }: FacebookPublishPanelProps) {
  const [snapshot, setSnapshot] = useState<FacebookPublishingSnapshot | null>(null);
  const [statusError, setStatusError] = useState('');
  const [workspace, setWorkspace] = useState(emptyFacebookPublishWorkspace);

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
    setWorkspace((current) => invalidateFacebookPublishApproval(current, message));
  }, [message]);

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
      || snapshot.lastPublication?.status === 'publishing'
      || (snapshot.lastPublication?.status === 'delivery_unknown' && !workspace.pageCheckAcknowledged)
    ) return;
    setWorkspace(openFacebookPublishConfirmation(finalMessage, crypto.randomUUID()));
  }

  async function publishNow() {
    const begun = beginFacebookPublishSubmission(workspace);
    setWorkspace(begun.state);
    if (!begun.shouldSubmit || !begun.state.idempotencyKey) return;
    try {
      const result = await publishFacebookText({
        companyId,
        jobId,
        message: begun.state.approvedMessage,
        idempotencyKey: begun.state.idempotencyKey,
        explicitApproval: true,
      });
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
  const publishDisabled = !snapshot?.configured
    || !snapshot.facebookPublishingEnabled
    || !normalizedMessage
    || unsupportedJob
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

      <p>Text-only - selected photos and videos will not be uploaded in this phase.</p>
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
            <div className="facebook-publish-review-status">
              <ShieldCheck size={18} aria-hidden="true" />
              <span>{privacyStatus}</span>
            </div>
            <p>Text-only - {selectedMediaCount ? `${selectedMediaCount} selected media item${selectedMediaCount === 1 ? '' : 's'} will` : 'selected media will'} not be uploaded.</p>
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
