import { useEffect, useMemo, useState } from 'react';
import { CalendarClock, CalendarX2, Facebook, Image, Send, ShieldCheck, X } from 'lucide-react';
import {
  cancelFacebookScheduledPublication,
  loadFacebookPublishingStatus,
  publishFacebookSinglePhoto,
  publishFacebookText,
  scheduleFacebookSinglePhoto,
  scheduleFacebookText,
} from '../../features/meta-publishing/clientApi';
import {
  FACEBOOK_PUBLISH_ERROR_MESSAGES,
  browserFacebookScheduleTimezone,
  facebookPublishingCharacterCount,
  facebookScheduledForUtc,
  formatFacebookScheduledTime,
  normalizeFacebookPublishingMessage,
  normalizePublishingError,
  publishingErrorCode,
  type FacebookPublishingSnapshot,
} from '../../features/meta-publishing/contracts';
import {
  beginFacebookPublishSubmission,
  beginFacebookScheduleCancellation,
  currentFacebookActiveSchedule,
  currentFacebookPublication,
  emptyFacebookPublishWorkspace,
  facebookPublicationInProgress,
  facebookPublicationNeedsPageCheck,
  invalidateFacebookPublishApproval,
  openFacebookPublishConfirmation,
  openFacebookScheduleCancellation,
  reconcileFacebookPublishWorkspaceFromStatus,
  resetFacebookPublishWorkspace,
} from '../../features/meta-publishing/workspaceState';

type FacebookPublishPanelProps = {
  companyId: string;
  jobId: string;
  jobStatus: string;
  message: string;
  selectedMediaCount: number;
  photoCatalog: Array<{
    attachmentId: string;
    displayName: string;
    previewUrl: string;
    mimeType: 'image/jpeg' | 'image/png';
  }>;
  refreshToken: number;
  privacyStatus: string;
};

type ContentMode = 'text_only' | 'single_photo';
type DeliveryMode = 'now' | 'scheduled';
const FACEBOOK_STATUS_REFRESH_MS = 45_000;

export function FacebookPublishPanel({ companyId, jobId, jobStatus, message, selectedMediaCount, photoCatalog, refreshToken, privacyStatus }: FacebookPublishPanelProps) {
  const [snapshot, setSnapshot] = useState<FacebookPublishingSnapshot | null>(null);
  const [statusError, setStatusError] = useState('');
  const [workspace, setWorkspace] = useState(emptyFacebookPublishWorkspace);
  const [mode, setMode] = useState<ContentMode>('text_only');
  const [delivery, setDelivery] = useState<DeliveryMode>('now');
  const [selectedAttachmentId, setSelectedAttachmentId] = useState('');
  const [scheduledLocal, setScheduledLocal] = useState(defaultScheduledLocalValue);
  const scheduledTimezone = useMemo(browserFacebookScheduleTimezone, []);
  const scheduledFor = delivery === 'scheduled' ? facebookScheduledForUtc(scheduledLocal) : null;

  useEffect(() => {
    let active = true;
    setSnapshot(null);
    setStatusError('');
    setWorkspace(resetFacebookPublishWorkspace());
    setMode('text_only');
    setDelivery('now');
    setSelectedAttachmentId('');
    setScheduledLocal(defaultScheduledLocalValue());
    loadFacebookPublishingStatus(companyId, jobId)
      .then((value) => {
        if (!active) return;
        setSnapshot(value);
        setWorkspace((current) => reconcileFacebookPublishWorkspaceFromStatus(current, value));
      })
      .catch(() => { if (active) setStatusError('Publishing status is unavailable.'); });
    return () => { active = false; };
  }, [companyId, jobId, refreshToken]);

  useEffect(() => {
    setWorkspace((current) => invalidateFacebookPublishApproval(
      current,
      message,
      mode,
      mode === 'single_photo' ? selectedAttachmentId || null : null,
      delivery,
      delivery === 'scheduled' ? scheduledFor : null,
      delivery === 'scheduled' ? scheduledTimezone : null,
    ));
  }, [delivery, message, mode, scheduledFor, scheduledTimezone, selectedAttachmentId]);

  useEffect(() => {
    if (!selectedAttachmentId) return;
    const stillEligible = (snapshot?.eligiblePhotos ?? []).some((photo) => (
      photo.attachmentId === selectedAttachmentId
      && photo.eligibleForFacebookPublication
      && photo.approvalStatus === 'approved'
      && photo.checksumMatch
      && photoCatalog.some((catalogPhoto) => catalogPhoto.attachmentId === selectedAttachmentId && catalogPhoto.previewUrl)
    ));
    if (!stillEligible) setSelectedAttachmentId('');
  }, [photoCatalog, snapshot, selectedAttachmentId]);

  const pageName = snapshot?.facebookPageName ?? 'Facebook Page';
  let normalizedMessage = '';
  try {
    normalizedMessage = normalizeFacebookPublishingMessage(message);
  } catch {}
  const durablePublication = currentFacebookPublication(workspace, snapshot);
  const activeScheduledPublication = currentFacebookActiveSchedule(workspace, snapshot);
  const publicationInProgress = facebookPublicationInProgress(durablePublication);
  const hasActiveScheduledPublication = activeScheduledPublication?.status === 'scheduled';
  const deliveryUnknown = !publicationInProgress
    && facebookPublicationNeedsPageCheck(durablePublication, workspace.errorCode);
  const unsupportedJob = !['Completed', 'Warranty'].includes(jobStatus);
  const photoCatalogById = new Map(photoCatalog.map((photo) => [photo.attachmentId, photo]));
  const serverEligiblePhotos = (snapshot?.eligiblePhotos ?? [])
    .filter((photo) => photo.eligibleForFacebookPublication && photo.approvalStatus === 'approved' && photo.checksumMatch)
    .map((photo) => {
      const localPhoto = photoCatalogById.get(photo.attachmentId);
      return localPhoto?.previewUrl
        ? { ...photo, displayName: localPhoto.displayName || photo.displayName, previewUrl: localPhoto.previewUrl, mimeType: localPhoto.mimeType }
        : { ...photo, previewUrl: null };
    })
    .filter((photo) => Boolean(photo.previewUrl));
  const selectedPhoto = serverEligiblePhotos.find((photo) => photo.attachmentId === selectedAttachmentId) ?? null;
  const scheduleTimeValid = delivery === 'now' || validFutureSchedule(scheduledFor);
  const publishDisabled = !snapshot?.configured
    || !snapshot.facebookPublishingEnabled
    || !normalizedMessage
    || unsupportedJob
    || (mode === 'single_photo' && !selectedPhoto?.previewUrl)
    || publicationInProgress
    || hasActiveScheduledPublication
    || deliveryUnknown
    || !scheduleTimeValid
    || workspace.submitting
    || workspace.cancelling;

  useEffect(() => {
    if ((!hasActiveScheduledPublication && !publicationInProgress) || workspace.submitting || workspace.cancelling) return undefined;
    let active = true;
    let timeoutId: number | undefined;

    const refreshStatus = async () => {
      try {
        const refreshed = await loadFacebookPublishingStatus(companyId, jobId);
        if (!active) return;
        setSnapshot(refreshed);
        setWorkspace((current) => reconcileFacebookPublishWorkspaceFromStatus(current, refreshed));
        setStatusError('');
      } catch {
        if (active) setStatusError('Publishing status refresh is unavailable.');
      }
      if (active) timeoutId = window.setTimeout(refreshStatus, FACEBOOK_STATUS_REFRESH_MS);
    };

    timeoutId = window.setTimeout(refreshStatus, FACEBOOK_STATUS_REFRESH_MS);
    return () => {
      active = false;
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
    };
  }, [companyId, hasActiveScheduledPublication, jobId, publicationInProgress, workspace.cancelling, workspace.submitting]);

  function openConfirmation() {
    if (publishDisabled) return;
    setWorkspace(openFacebookPublishConfirmation(
      normalizedMessage,
      crypto.randomUUID(),
      mode,
      mode === 'single_photo' ? selectedAttachmentId : null,
      delivery,
      delivery === 'scheduled' ? scheduledFor : null,
      delivery === 'scheduled' ? scheduledTimezone : null,
    ));
  }

  async function submitPublication() {
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
      const result = begun.state.delivery === 'scheduled'
        ? begun.state.mode === 'single_photo'
          ? await scheduleFacebookSinglePhoto({
              ...common,
              attachmentId: begun.state.approvedAttachmentId ?? '',
              scheduledFor: begun.state.approvedScheduledFor ?? '',
              scheduledTimezone: begun.state.approvedScheduledTimezone ?? '',
            })
          : await scheduleFacebookText({
              ...common,
              scheduledFor: begun.state.approvedScheduledFor ?? '',
              scheduledTimezone: begun.state.approvedScheduledTimezone ?? '',
            })
        : begun.state.mode === 'single_photo'
          ? await publishFacebookSinglePhoto({ ...common, attachmentId: begun.state.approvedAttachmentId ?? '' })
          : await publishFacebookText(common);
      setWorkspace((current) => ({ ...current, confirmationOpen: false, submitting: false, result, error: '', errorCode: '' }));
      setSnapshot((current) => current ? {
        ...current,
        lastPublication: result,
        activeScheduledPublication: result.status === 'scheduled' ? {
          status: 'scheduled',
          publicationId: result.publicationId,
          scheduledFor: result.scheduledFor,
          scheduledTimezone: result.scheduledTimezone,
          publicationKind: result.publicationKind,
          errorCode: result.errorCode,
        } : current.activeScheduledPublication,
      } : current);
    } catch (error) {
      const errorCode = publishingErrorCode(error);
      if (errorCode === 'META_PUBLICATION_DELIVERY_UNKNOWN' || errorCode === 'META_PUBLICATION_ACTIVE_CONFLICT') {
        try {
          const refreshed = await loadFacebookPublishingStatus(companyId, jobId);
          setSnapshot(refreshed);
          setWorkspace((current) => reconcileFacebookPublishWorkspaceFromStatus(current, refreshed));
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

  async function cancelScheduledPublication() {
    const begun = beginFacebookScheduleCancellation(workspace);
    setWorkspace(begun.state);
    const publicationId = activeScheduledPublication?.status === 'scheduled' ? activeScheduledPublication.publicationId : null;
    if (!begun.shouldSubmit || !publicationId) return;
    try {
      await cancelFacebookScheduledPublication({ companyId, publicationId, explicitApproval: true });
      const refreshed = await loadFacebookPublishingStatus(companyId, jobId);
      setSnapshot(refreshed);
      setWorkspace(reconcileFacebookPublishWorkspaceFromStatus(resetFacebookPublishWorkspace(), refreshed));
    } catch (error) {
      let refreshed: FacebookPublishingSnapshot | null = null;
      try {
        refreshed = await loadFacebookPublishingStatus(companyId, jobId);
        setSnapshot(refreshed);
      } catch {
        // Keep the last known state when the authoritative status cannot be loaded.
      }
      setWorkspace((current) => {
        const reconciled = refreshed
          ? reconcileFacebookPublishWorkspaceFromStatus(current, refreshed)
          : current;
        return {
          ...reconciled,
          cancelConfirmationOpen: false,
          cancelling: false,
          approved: false,
          error: normalizePublishingError(error),
          errorCode: publishingErrorCode(error),
        };
      });
    }
  }

  const durableScheduledTime = activeScheduledPublication?.scheduledFor && activeScheduledPublication.scheduledTimezone
    ? formatFacebookScheduledTime(activeScheduledPublication.scheduledFor, activeScheduledPublication.scheduledTimezone)
    : '';
  const confirmationScheduledTime = workspace.approvedScheduledFor && workspace.approvedScheduledTimezone
    ? formatFacebookScheduledTime(workspace.approvedScheduledFor, workspace.approvedScheduledTimezone)
    : '';

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

      <div>
        <strong className="facebook-publish-control-label">Content</strong>
        <div className="facebook-publish-mode" role="group" aria-label="Facebook content mode">
          <button type="button" className={mode === 'text_only' ? 'active' : ''} onClick={() => setMode('text_only')} disabled={workspace.submitting || workspace.cancelling}>
            Text only
          </button>
          <button type="button" className={mode === 'single_photo' ? 'active' : ''} onClick={() => setMode('single_photo')} disabled={workspace.submitting || workspace.cancelling}>
            <Image size={15} aria-hidden="true" />
            Single photo
          </button>
        </div>
      </div>

      <div>
        <strong className="facebook-publish-control-label">Delivery</strong>
        <div className="facebook-publish-mode" role="group" aria-label="Facebook delivery mode">
          <button type="button" className={delivery === 'now' ? 'active' : ''} onClick={() => setDelivery('now')} disabled={workspace.submitting || workspace.cancelling}>
            <Send size={15} aria-hidden="true" />
            Publish now
          </button>
          <button type="button" className={delivery === 'scheduled' ? 'active' : ''} onClick={() => setDelivery('scheduled')} disabled={workspace.submitting || workspace.cancelling}>
            <CalendarClock size={15} aria-hidden="true" />
            Schedule for later
          </button>
        </div>
      </div>

      {delivery === 'scheduled' ? (
        <div className="facebook-schedule-fields">
          <label>
            <span>Date and time</span>
            <input type="datetime-local" value={scheduledLocal} min={minimumScheduledLocalValue()} onChange={(event) => setScheduledLocal(event.target.value)} />
          </label>
          <label>
            <span>Timezone</span>
            <input type="text" value={scheduledTimezone} readOnly />
          </label>
          {scheduledFor && scheduleTimeValid ? (
            <p>Scheduled local time: <strong>{formatFacebookScheduledTime(scheduledFor, scheduledTimezone)}</strong></p>
          ) : <p className="facebook-publish-result error">Choose a future date and time within 366 days.</p>}
        </div>
      ) : null}

      {mode === 'text_only' ? <p>Text-only - selected photos and videos will not be uploaded.</p> : null}
      {mode === 'single_photo' ? (
        <div className="facebook-photo-picker">
          <p>Exactly one approved selected photo will be used for Facebook Page {pageName}.</p>
          {serverEligiblePhotos.length ? serverEligiblePhotos.map((photo) => (
            <label className="facebook-photo-option" key={photo.attachmentId}>
              <input
                type="radio"
                name="facebook-single-photo"
                checked={selectedAttachmentId === photo.attachmentId}
                onChange={() => setSelectedAttachmentId(photo.attachmentId)}
                disabled={workspace.submitting || workspace.cancelling}
              />
              <img src={photo.previewUrl ?? ''} alt={photo.displayName} />
              <span>{photo.displayName || 'Approved photo'}</span>
            </label>
          )) : <p className="facebook-publish-result error">Approve one analyzed selected photo and wait for server eligibility before using a photo.</p>}
        </div>
      ) : null}

      {unsupportedJob ? <p className="facebook-publish-result error">Facebook publishing is available only for Completed and Warranty jobs.</p> : null}
      {publicationInProgress ? <p className="facebook-publish-result error">A Facebook publication for this job is already in progress.</p> : null}
      {deliveryUnknown ? (
        <div className="facebook-publish-result error">
          <p>Facebook did not confirm whether the post was published.</p>
          <p>Publishing this exact request is blocked until a reconciliation workflow resolves the unknown delivery state.</p>
        </div>
      ) : null}
      {hasActiveScheduledPublication ? (
        <div className="facebook-scheduled-status">
          <CalendarClock size={18} aria-hidden="true" />
          <div>
            <strong>Facebook publication scheduled</strong>
            <span>{durableScheduledTime} ({activeScheduledPublication.scheduledTimezone})</span>
            <span>{activeScheduledPublication.publicationKind === 'single_photo' ? 'Single photo' : 'Text only'} · Facebook Page {pageName}</span>
          </div>
          <button className="secondary-button" type="button" onClick={() => setWorkspace((current) => openFacebookScheduleCancellation(current))} disabled={workspace.submitting || workspace.cancelling}>
            <CalendarX2 size={16} aria-hidden="true" />
            Cancel scheduled publication
          </button>
        </div>
      ) : null}
      {durablePublication?.status === 'cancelled' ? <p className="facebook-publish-result">The latest scheduled Facebook publication was cancelled.</p> : null}
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
        {delivery === 'scheduled' ? <CalendarClock size={16} aria-hidden="true" /> : <Send size={16} aria-hidden="true" />}
        {delivery === 'scheduled' ? 'Review schedule' : 'Review and publish'}
      </button>
      {workspace.error ? <p className="facebook-publish-result error">{workspace.error}</p> : null}

      {workspace.confirmationOpen ? (
        <div className="facebook-publish-modal-backdrop" role="presentation">
          <section className="facebook-publish-modal" role="dialog" aria-modal="true" aria-labelledby="facebook-publish-title">
            <header>
              <div>
                <h3 id="facebook-publish-title">{workspace.delivery === 'scheduled' ? 'Schedule' : 'Publish to'} Facebook Page {pageName}</h3>
                <span>{facebookPublishingCharacterCount(workspace.approvedMessage)} characters</span>
              </div>
              <button className="icon-button" type="button" title="Close" onClick={() => setWorkspace(emptyFacebookPublishWorkspace)} disabled={workspace.submitting}>
                <X size={18} aria-hidden="true" />
              </button>
            </header>
            <div className="facebook-publish-preview">{workspace.approvedMessage}</div>
            {workspace.mode === 'single_photo' && selectedPhoto?.previewUrl ? (
              <div className="facebook-publish-photo-review">
                <img src={selectedPhoto.previewUrl} alt={selectedPhoto.displayName} />
                <span>{selectedPhoto.displayName || 'Approved photo'}</span>
              </div>
            ) : null}
            {workspace.delivery === 'scheduled' ? (
              <div className="facebook-schedule-confirmation">
                <span>Scheduled local time</span>
                <strong>{confirmationScheduledTime}</strong>
                <span>Timezone: {workspace.approvedScheduledTimezone}</span>
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
              <span>{workspace.delivery === 'scheduled'
                ? 'I reviewed the exact final text, media and scheduled time and approve scheduling this Facebook publication.'
                : 'I reviewed the exact final text and approve publishing it to the Facebook Page now.'}</span>
            </label>
            <footer>
              <button className="secondary-button" type="button" onClick={() => setWorkspace(emptyFacebookPublishWorkspace)} disabled={workspace.submitting}>Cancel</button>
              <button className="primary-button" type="button" onClick={submitPublication} disabled={!workspace.approved || workspace.submitting}>
                {workspace.delivery === 'scheduled' ? <CalendarClock size={16} aria-hidden="true" /> : <Send size={16} aria-hidden="true" />}
                {workspace.submitting
                  ? workspace.delivery === 'scheduled' ? 'Scheduling...' : 'Publishing...'
                  : workspace.delivery === 'scheduled' ? 'Schedule publication' : 'Publish now'}
              </button>
            </footer>
          </section>
        </div>
      ) : null}

      {workspace.cancelConfirmationOpen && hasActiveScheduledPublication ? (
        <div className="facebook-publish-modal-backdrop" role="presentation">
          <section className="facebook-publish-modal" role="dialog" aria-modal="true" aria-labelledby="facebook-cancel-schedule-title">
            <header>
              <div>
                <h3 id="facebook-cancel-schedule-title">Cancel scheduled Facebook publication</h3>
                <span>Facebook Page {pageName}</span>
              </div>
              <button className="icon-button" type="button" title="Close" onClick={() => setWorkspace((current) => ({ ...current, cancelConfirmationOpen: false, approved: false }))} disabled={workspace.cancelling}>
                <X size={18} aria-hidden="true" />
              </button>
            </header>
            <div className="facebook-schedule-confirmation">
              <strong>{durableScheduledTime}</strong>
              <span>Timezone: {activeScheduledPublication.scheduledTimezone}</span>
              <span>{activeScheduledPublication.publicationKind === 'single_photo' ? 'Single photo' : 'Text only'}</span>
            </div>
            <label className="facebook-publish-approval">
              <input
                type="checkbox"
                checked={workspace.approved}
                onChange={(event) => setWorkspace((current) => ({ ...current, approved: event.target.checked }))}
                disabled={workspace.cancelling}
              />
              <span>I approve cancelling this still-scheduled Facebook publication.</span>
            </label>
            <footer>
              <button className="secondary-button" type="button" onClick={() => setWorkspace((current) => ({ ...current, cancelConfirmationOpen: false, approved: false }))} disabled={workspace.cancelling}>Keep schedule</button>
              <button className="primary-button danger" type="button" onClick={cancelScheduledPublication} disabled={!workspace.approved || workspace.cancelling}>
                <CalendarX2 size={16} aria-hidden="true" />
                {workspace.cancelling ? 'Cancelling...' : 'Cancel scheduled publication'}
              </button>
            </footer>
          </section>
        </div>
      ) : null}
    </section>
  );
}

function validFutureSchedule(value: string | null) {
  if (!value) return false;
  const scheduledMs = Date.parse(value);
  const now = Date.now();
  return Number.isFinite(scheduledMs) && scheduledMs > now && scheduledMs <= now + 366 * 24 * 60 * 60 * 1000;
}

function defaultScheduledLocalValue() {
  const date = new Date(Date.now() + 60 * 60 * 1000);
  date.setSeconds(0, 0);
  return localDateTimeValue(date);
}

function minimumScheduledLocalValue() {
  return localDateTimeValue(new Date(Date.now() + 60_000));
}

function localDateTimeValue(date: Date) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}
