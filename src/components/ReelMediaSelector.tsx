import { useEffect, useMemo, useState } from 'react';
import { Check, ChevronDown, ChevronUp, Plus, ScanLine, Trash2 } from 'lucide-react';
import type { JobAttachment } from '../types';
import { attachmentUrl } from '../features/job-attachments/jobAttachmentFiles';
import { analyzeSelectedMedia } from '../features/media-analysis/clientApi';
import { normalizeMediaAnalysisError } from '../features/media-analysis/contracts';
import {
  loadReelMediaSelection,
  saveReelMediaSelection,
} from '../features/reel-media-selection/clientApi';
import {
  REEL_MEDIA_ROLES,
  type ReelMediaRole,
  type ReelMediaSelectionDraftItem,
  type ReelMediaSelectionResponse,
} from '../features/reel-media-selection/contracts';
import {
  MAX_REEL_MEDIA_SELECTION,
  isReelMediaSelectionReady,
  normalizeReelMediaSelection,
  reelMediaSelectionDraft,
} from '../features/reel-media-selection/selectionState';

type ReelMediaSelectorProps = {
  jobId: string;
  attachments: JobAttachment[];
};

const roleLabels: Record<ReelMediaRole, string> = {
  problem: 'Problem / Context',
  process: 'Process',
  result: 'Result',
  supporting: 'Supporting',
};

const privacyLabels = {
  passed: 'PASS',
  needs_review: 'Needs review',
  not_analyzed: 'Not analyzed',
};

export function ReelMediaSelector({ jobId, attachments }: ReelMediaSelectorProps) {
  const [selection, setSelection] = useState<ReelMediaSelectionResponse | null>(null);
  const [draft, setDraft] = useState<ReelMediaSelectionDraftItem[]>([]);
  const [status, setStatus] = useState('Loading media...');
  const [saving, setSaving] = useState(false);
  const [analyzingId, setAnalyzingId] = useState<string | null>(null);
  const attachmentById = useMemo(() => new Map(attachments.map((item) => [item.id, item])), [attachments]);

  useEffect(() => {
    let active = true;
    setSelection(null);
    setDraft([]);
    setStatus('Loading media...');
    loadReelMediaSelection(jobId)
      .then((value) => {
        if (!active) return;
        setSelection(value);
        setDraft(reelMediaSelectionDraft(value.items));
        setStatus('');
      })
      .catch((error) => {
        if (!active) return;
        setStatus(error instanceof Error ? error.message : 'Media selection could not be loaded.');
      });
    return () => { active = false; };
  }, [jobId]);

  const draftById = new Map(draft.map((item) => [item.attachmentId, item]));
  const hasChanges = selection
    ? JSON.stringify(draft) !== JSON.stringify(reelMediaSelectionDraft(selection.items))
    : false;
  const draftReady = selection ? isReelMediaSelectionReady(selection.items.map((item) => ({
    ...item,
    role: draftById.get(item.attachmentId)?.role ?? null,
    position: draftById.get(item.attachmentId)?.position ?? null,
  }))) : false;

  function addItem(attachmentId: string) {
    if (!selection?.canManage || draft.length >= MAX_REEL_MEDIA_SELECTION || draftById.has(attachmentId)) return;
    const usedRoles = new Set(draft.map((item) => item.role));
    const role = REEL_MEDIA_ROLES.find((item) => !usedRoles.has(item)) ?? 'supporting';
    setDraft(normalizeReelMediaSelection([...draft, { attachmentId, role }]));
  }

  function removeItem(attachmentId: string) {
    if (!selection?.canManage) return;
    setDraft(normalizeReelMediaSelection(draft.filter((item) => item.attachmentId !== attachmentId)));
  }

  function updateRole(attachmentId: string, role: ReelMediaRole) {
    if (!selection?.canManage) return;
    setDraft(draft.map((item) => item.attachmentId === attachmentId ? { ...item, role } : item));
  }

  function moveItem(attachmentId: string, direction: -1 | 1) {
    if (!selection?.canManage) return;
    const current = draft.findIndex((item) => item.attachmentId === attachmentId);
    const target = current + direction;
    if (current < 0 || target < 0 || target >= draft.length) return;
    const reordered = [...draft];
    [reordered[current], reordered[target]] = [reordered[target], reordered[current]];
    setDraft(normalizeReelMediaSelection(reordered));
  }

  async function save() {
    if (!selection?.canManage || saving) return;
    setSaving(true);
    setStatus('Saving...');
    try {
      const value = await saveReelMediaSelection(jobId, draft);
      setSelection(value);
      setDraft(reelMediaSelectionDraft(value.items));
      setStatus('Selection saved.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Selection could not be saved.');
    } finally {
      setSaving(false);
    }
  }

  async function analyzeOne(attachmentId: string) {
    if (!selection?.canManage || analyzingId) return;
    setAnalyzingId(attachmentId);
    setStatus('Analyzing one image...');
    try {
      await analyzeSelectedMedia({
        jobId,
        attachmentIds: [attachmentId],
        idempotencyKey: `${jobId}:reel-selector:${attachmentId}:${Date.now()}:${crypto.randomUUID()}`,
      });
      const value = await loadReelMediaSelection(jobId);
      setSelection(value);
      setStatus('Analysis complete.');
    } catch (error) {
      setStatus(normalizeMediaAnalysisError(error).message);
    } finally {
      setAnalyzingId(null);
    }
  }

  return (
    <section className="job-detail-card reel-media-selector">
      <div className="reel-media-selector-heading">
        <div>
          <p className="eyebrow">AI Reel</p>
          <h2>Reel Media</h2>
        </div>
        <span className={`reel-media-readiness ${draftReady ? 'ready' : ''}`}>
          {draftReady ? <Check size={14} aria-hidden="true" /> : null}
          {draftReady ? 'Ready' : 'Not ready'}
        </span>
      </div>

      <div className="reel-media-selector-list">
        {(selection?.items ?? []).map((item) => {
          const draftItem = draftById.get(item.attachmentId);
          const draftIndex = draft.findIndex((candidate) => candidate.attachmentId === item.attachmentId);
          const attachment = attachmentById.get(item.attachmentId);
          const preview = attachment ? attachmentUrl(attachment) : '';
          return (
            <article className={`reel-media-selector-item ${draftItem ? 'selected' : ''}`} key={item.attachmentId}>
              {preview ? <img src={preview} alt={item.name} /> : <div className="reel-media-selector-placeholder">IMG</div>}
              <div className="reel-media-selector-copy">
                <strong>{item.name}</strong>
                <span className={`reel-media-privacy ${item.privacyState}`}>{privacyLabels[item.privacyState]}</span>
              </div>
              {draftItem ? (
                <>
                  <select
                    aria-label={`Role for ${item.name}`}
                    value={draftItem.role}
                    disabled={!selection?.canManage}
                    onChange={(event) => updateRole(item.attachmentId, event.target.value as ReelMediaRole)}
                  >
                    {REEL_MEDIA_ROLES.map((role) => <option key={role} value={role}>{roleLabels[role]}</option>)}
                  </select>
                  <div className="reel-media-selector-actions">
                    <button type="button" title="Move up" aria-label={`Move ${item.name} up`} disabled={!selection?.canManage || draftIndex === 0} onClick={() => moveItem(item.attachmentId, -1)}><ChevronUp size={16} /></button>
                    <button type="button" title="Move down" aria-label={`Move ${item.name} down`} disabled={!selection?.canManage || draftIndex === draft.length - 1} onClick={() => moveItem(item.attachmentId, 1)}><ChevronDown size={16} /></button>
                    <button type="button" title="Remove" aria-label={`Remove ${item.name}`} disabled={!selection?.canManage} onClick={() => removeItem(item.attachmentId)}><Trash2 size={16} /></button>
                  </div>
                  {item.privacyState !== 'passed' ? (
                    <button
                      className="secondary-button compact reel-media-analyze"
                      type="button"
                      disabled={!selection?.canManage || Boolean(analyzingId)}
                      onClick={() => analyzeOne(item.attachmentId)}
                    >
                      <ScanLine size={15} aria-hidden="true" />
                      {analyzingId === item.attachmentId ? 'Analyzing...' : 'Analyze image'}
                    </button>
                  ) : null}
                </>
              ) : (
                <button
                  className="secondary-button compact reel-media-add"
                  type="button"
                  disabled={!selection?.canManage || draft.length >= MAX_REEL_MEDIA_SELECTION}
                  onClick={() => addItem(item.attachmentId)}
                >
                  <Plus size={15} aria-hidden="true" />
                  Select
                </button>
              )}
            </article>
          );
        })}
        {selection && selection.items.length === 0 ? <p className="empty-inline">No supported saved photos.</p> : null}
      </div>

      <div className="job-detail-actions">
        <button className="primary-button" type="button" disabled={!selection?.canManage || !hasChanges || saving} onClick={save}>
          Save selection
        </button>
        <span>{selection?.canManage === false ? 'Read only' : status || `${draft.length}/${MAX_REEL_MEDIA_SELECTION} selected`}</span>
      </div>
    </section>
  );
}
