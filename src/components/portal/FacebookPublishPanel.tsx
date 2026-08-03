import { useEffect, useState } from 'react';
import { Facebook, Send, ShieldCheck, X } from 'lucide-react';
import { loadFacebookPublishingStatus, publishFacebookText } from '../../features/meta-publishing/clientApi';
import { normalizePublishingError, type FacebookPublishingSnapshot } from '../../features/meta-publishing/contracts';
import {
  beginFacebookPublishSubmission,
  emptyFacebookPublishWorkspace,
  invalidateFacebookPublishApproval,
  openFacebookPublishConfirmation,
} from '../../features/meta-publishing/workspaceState';

type FacebookPublishPanelProps = {
  companyId: string;
  jobId: string;
  message: string;
  selectedMediaCount: number;
  privacyStatus: string;
};

export function FacebookPublishPanel({ companyId, jobId, message, selectedMediaCount, privacyStatus }: FacebookPublishPanelProps) {
  const [snapshot, setSnapshot] = useState<FacebookPublishingSnapshot | null>(null);
  const [statusError, setStatusError] = useState('');
  const [workspace, setWorkspace] = useState(emptyFacebookPublishWorkspace);

  useEffect(() => {
    let active = true;
    setSnapshot(null);
    setStatusError('');
    loadFacebookPublishingStatus(companyId)
      .then((value) => { if (active) setSnapshot(value); })
      .catch(() => { if (active) setStatusError('Publishing status is unavailable.'); });
    return () => { active = false; };
  }, [companyId]);

  useEffect(() => {
    setWorkspace((current) => invalidateFacebookPublishApproval(current, message));
  }, [message]);

  function openConfirmation() {
    const finalMessage = message.trim();
    if (!finalMessage || finalMessage.length > 5000 || !snapshot?.facebookPublishingEnabled) return;
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
    } catch (error) {
      setWorkspace((current) => ({
        ...current,
        confirmationOpen: false,
        submitting: false,
        result: null,
        error: normalizePublishingError(error),
      }));
    }
  }

  const pageName = snapshot?.facebookPageName ?? 'Facebook Page';
  const settledForCurrentDraft = workspace.approvedMessage === message.trim() && Boolean(workspace.result || workspace.error);
  const publishDisabled = !snapshot?.configured
    || !snapshot.facebookPublishingEnabled
    || !message.trim()
    || message.trim().length > 5000
    || settledForCurrentDraft;

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
      <button className="primary-button" type="button" onClick={openConfirmation} disabled={publishDisabled}>
        <Send size={16} aria-hidden="true" />
        Review and publish
      </button>

      {workspace.result?.status === 'published' ? (
        <p className="facebook-publish-result success">Published to Facebook Page {pageName}.</p>
      ) : null}
      {workspace.error ? <p className="facebook-publish-result error">{workspace.error}</p> : null}

      {workspace.confirmationOpen ? (
        <div className="facebook-publish-modal-backdrop" role="presentation">
          <section className="facebook-publish-modal" role="dialog" aria-modal="true" aria-labelledby="facebook-publish-title">
            <header>
              <div>
                <h3 id="facebook-publish-title">Publish to Facebook Page {pageName}</h3>
                <span>{workspace.approvedMessage.length} characters</span>
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
