import { useEffect, useMemo, useState } from 'react';
import { Bot, BriefcaseBusiness, CheckCircle2, Copy, Download, Image, Lock, Video } from 'lucide-react';
import type { MaterialRow, ServiceJob } from '../../types';
import {
  ASSISTANT_CHANNELS,
  type AssistantChannel,
  type AssistantDraftWorkspaceState,
  type AssistantLocalFacts,
  type AssistantMediaLabel,
  type AssistantMediaState,
  buildAssistantChannelDrafts,
  buildAssistantExportText,
  buildAssistantJobContext,
  buildAssistantJobSummary,
  canOpenJobInAiAssistant,
  assistantMediaCounts,
  hydrateAssistantDraftState,
  regenerateAssistantChannelDraft,
  regenerateUneditedAssistantDrafts,
  scrubAssistantText,
} from '../../features/ai-assistant/assistantModel';
import { attachmentUrl, downloadJobAttachments } from '../../features/job-attachments/jobAttachmentFiles';

const mediaLabels: AssistantMediaLabel[] = ['Overview', 'Problem', 'Repair', 'Part', 'Result'];

type AiAssistantPageProps = {
  selectedJob: ServiceJob | null;
  materials: MaterialRow[];
};

export function AiAssistantPage({ selectedJob, materials }: AiAssistantPageProps) {
  const [selectedChannels, setSelectedChannels] = useState<AssistantChannel[]>(['Instagram']);
  const [localFacts, setLocalFacts] = useState<AssistantLocalFacts>({});
  const [mediaState, setMediaState] = useState<AssistantMediaState[]>([]);
  const [draftWorkspace, setDraftWorkspace] = useState<AssistantDraftWorkspaceState>({ drafts: {}, statuses: {} });
  const [copyStatus, setCopyStatus] = useState('');

  useEffect(() => {
    setLocalFacts({});
    setMediaState([]);
    setDraftWorkspace({ drafts: {}, statuses: {} });
    setCopyStatus('');
  }, [selectedJob?.id]);

  const summary = selectedJob ? buildAssistantJobSummary(selectedJob) : null;
  const mediaCounts = selectedJob ? assistantMediaCounts(selectedJob) : { photos: 0, videos: 0 };
  const unsupportedStatus = selectedJob && !canOpenJobInAiAssistant(selectedJob.status);
  const assistantContext = useMemo(
    () => (selectedJob ? buildAssistantJobContext(selectedJob, materials, localFacts, mediaState) : null),
    [selectedJob, materials, localFacts, mediaState],
  );
  const generatedDrafts = useMemo(() => (assistantContext ? buildAssistantChannelDrafts(assistantContext) : []), [assistantContext]);

  useEffect(() => {
    setDraftWorkspace((current) => hydrateAssistantDraftState(generatedDrafts, current.drafts, current.statuses));
  }, [generatedDrafts]);

  const selectedDrafts = generatedDrafts.filter((draft) => selectedChannels.includes(draft.channel));
  const selectedMediaIds = new Set(assistantContext?.publicSafe.media.filter((item) => item.selected).map((item) => item.id) ?? []);
  const selectedMediaAttachments = (selectedJob?.attachments ?? []).filter((attachment) => selectedMediaIds.has(attachment.id));
  const attachmentById = useMemo(
    () => new Map((selectedJob?.attachments ?? []).map((attachment) => [attachment.id, attachment])),
    [selectedJob],
  );

  function updateLocalFact(field: keyof AssistantLocalFacts, value: string) {
    setLocalFacts((current) => ({ ...current, [field]: value }));
  }

  function toggleChannel(channel: AssistantChannel) {
    setSelectedChannels((current) => (
      current.includes(channel)
        ? current.filter((item) => item !== channel)
        : [...current, channel]
    ));
  }

  function updateMediaItem(id: string, patch: Partial<AssistantMediaState>) {
    setMediaState((current) => {
      const existing = current.find((item) => item.id === id);
      if (existing) return current.map((item) => (item.id === id ? { ...item, ...patch } : item));
      return [...current, { id, ...patch }];
    });
  }

  function moveMedia(id: string, direction: -1 | 1) {
    if (!assistantContext) return;
    const ordered = assistantContext.publicSafe.media.map((item, index) => ({ id: item.id, order: index }));
    const index = ordered.findIndex((item) => item.id === id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= ordered.length) return;
    [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
    setMediaState((current) => {
      const currentById = new Map(current.map((item) => [item.id, item]));
      return ordered.map((item, order) => ({ ...currentById.get(item.id), id: item.id, order }));
    });
  }

  async function copyDraft(channel: AssistantChannel) {
    const text = draftWorkspace.drafts[channel] ?? '';
    if (!assistantContext || !text.trim()) return;
    const copied = await copyText(scrubAssistantText(text, assistantContext));
    setCopyStatus(copied ? `${channel} draft copied.` : `${channel} draft could not be copied. Select the text and copy it manually.`);
  }

  async function copyAllSelected() {
    if (!assistantContext || selectedDrafts.length === 0) return;
    const drafts = selectedDrafts.map((draft) => ({ ...draft, body: draftWorkspace.drafts[draft.channel] ?? draft.body }));
    const copied = await copyText(buildAssistantExportText(drafts, assistantContext));
    setCopyStatus(copied ? 'Selected drafts copied.' : 'Selected drafts could not be copied. Select the text and copy it manually.');
  }

  function regenerateDraft(channel: AssistantChannel) {
    const result = regenerateAssistantChannelDraft(channel, generatedDrafts, draftWorkspace.drafts, draftWorkspace.statuses);
    setDraftWorkspace({ drafts: result.drafts, statuses: result.statuses });
    setCopyStatus(result.regenerated ? `${channel} draft regenerated from current job context.` : `${channel} draft could not be regenerated.`);
  }

  function regenerateAllUneditedDrafts() {
    const result = regenerateUneditedAssistantDrafts(generatedDrafts, draftWorkspace.drafts, draftWorkspace.statuses);
    setDraftWorkspace({ drafts: result.drafts, statuses: result.statuses });
    setCopyStatus(`${result.regenerated} generated draft${result.regenerated === 1 ? '' : 's'} refreshed. Edited drafts were not changed.`);
  }

  async function downloadSelectedMedia() {
    const results = await downloadJobAttachments(selectedMediaAttachments);
    const downloaded = results.filter((result) => result.ok).length;
    const failed = results.filter((result) => !result.ok);
    if (downloaded && failed.length) {
      setCopyStatus(`${downloaded} media file${downloaded === 1 ? '' : 's'} downloaded. ${failed.length} unavailable.`);
    } else if (downloaded) {
      setCopyStatus(`${downloaded} selected media file${downloaded === 1 ? '' : 's'} downloaded.`);
    } else {
      setCopyStatus(failed[0]?.error ?? 'Selected media must be saved before download.');
    }
  }

  return (
    <section className="ai-assistant-page">
      <header className="ai-assistant-header">
        <div>
          <p className="eyebrow">Workspace</p>
          <h1>AI Assistant</h1>
        </div>
        <Bot size={28} aria-hidden="true" />
      </header>

      <div className="ai-assistant-grid">
        <section className="ai-assistant-panel selected-job">
          <div className="ai-assistant-panel-heading">
            <h2>Selected Job</h2>
            <BriefcaseBusiness size={18} aria-hidden="true" />
          </div>
          {summary && assistantContext ? (
            <>
              <div className="ai-assistant-job-summary">
                <span>Status</span>
                <strong>{summary.status}</strong>
                <span>System</span>
                <strong>{summary.system}</strong>
              </div>
              <p className="ai-assistant-safe-description">{summary.description}</p>
              {assistantContext.missingInformation.length ? (
                <ul className="ai-assistant-missing-list" aria-label="Missing information">
                  {assistantContext.missingInformation.map((item) => <li key={item}>{item}</li>)}
                </ul>
              ) : null}
              {unsupportedStatus ? (
                <p className="ai-assistant-status-note">
                  AI Assistant accepts Completed and Warranty jobs. This job is shown for context only.
                </p>
              ) : null}
            </>
          ) : (
            <p className="empty-inline">Open a Completed or Warranty job, then choose Open in AI Assistant.</p>
          )}
        </section>

        <section className="ai-assistant-panel">
          <div className="ai-assistant-panel-heading">
            <h2>Media</h2>
            <Image size={18} aria-hidden="true" />
          </div>
          <div className="ai-assistant-media-counts">
            <span>
              <Image size={18} aria-hidden="true" />
              <strong>{mediaCounts.photos}</strong>
              Photos
            </span>
            <span>
              <Video size={18} aria-hidden="true" />
              <strong>{mediaCounts.videos}</strong>
              Videos
            </span>
          </div>
          <button className="secondary-button compact" type="button" onClick={downloadSelectedMedia} disabled={!selectedMediaAttachments.length}>
            <Download size={16} aria-hidden="true" />
            Download selected media
          </button>
        </section>

        <section className="ai-assistant-panel privacy">
          <div className="ai-assistant-panel-heading">
            <h2>Privacy</h2>
            <Lock size={18} aria-hidden="true" />
          </div>
          <p>
            Client identity, company, phone, email, address, job number, prices, invoices, payments, private notes,
            and comments are blocked from generated drafts, copy, export, URLs, hashes, and local storage.
          </p>
        </section>
      </div>

      {assistantContext ? (
        <>
          <section className="ai-assistant-panel ai-assistant-facts">
            <div className="ai-assistant-panel-heading">
              <h2>Technician Facts</h2>
              <CheckCircle2 size={18} aria-hidden="true" />
            </div>
            <label>
              Diagnosis
              <textarea value={localFacts.diagnosis ?? ''} onChange={(event) => updateLocalFact('diagnosis', event.target.value)} />
            </label>
            <label>
              Repair performed
              <textarea value={localFacts.repairPerformed ?? ''} onChange={(event) => updateLocalFact('repairPerformed', event.target.value)} />
            </label>
            <label>
              Final result
              <textarea value={localFacts.finalResult ?? ''} onChange={(event) => updateLocalFact('finalResult', event.target.value)} />
            </label>
          </section>

          <section className="ai-assistant-media-browser" aria-label="Assistant media">
            {assistantContext.publicSafe.media.map((item, index) => (
              <article className="ai-assistant-media-card" key={item.id}>
                {item.kind === 'photo' && attachmentUrl(attachmentById.get(item.id) ?? item) ? (
                  <img src={attachmentUrl(attachmentById.get(item.id) ?? item)} alt={item.name} />
                ) : (
                  <div className="ai-assistant-media-placeholder">{/^video\//i.test(item.mimeType) ? 'Video' : 'Media'}</div>
                )}
                <label className="ai-assistant-checkbox">
                  <input type="checkbox" checked={item.selected} onChange={(event) => updateMediaItem(item.id, { selected: event.target.checked })} />
                  Selected
                </label>
                <select value={item.label ?? ''} onChange={(event) => updateMediaItem(item.id, { label: event.target.value as AssistantMediaLabel })}>
                  <option value="">No label</option>
                  {mediaLabels.map((label) => <option key={label} value={label}>{label}</option>)}
                </select>
                <div className="ai-assistant-media-order">
                  <button className="secondary-button compact" type="button" onClick={() => moveMedia(item.id, -1)} disabled={index === 0}>Up</button>
                  <button className="secondary-button compact" type="button" onClick={() => moveMedia(item.id, 1)} disabled={index === assistantContext.publicSafe.media.length - 1}>Down</button>
                </div>
              </article>
            ))}
            {assistantContext.publicSafe.media.length === 0 ? <p className="empty-inline">No photos or videos attached.</p> : null}
          </section>

          <section className="ai-assistant-capabilities" aria-label="Assistant channels">
            {ASSISTANT_CHANNELS.map((label) => {
              const selected = selectedChannels.includes(label);
              return (
                <button className={`ai-assistant-capability ${selected ? 'selected' : ''}`} type="button" key={label} onClick={() => toggleChannel(label)} aria-pressed={selected}>
                  <CheckCircle2 size={18} aria-hidden="true" />
                  <strong>{label}</strong>
                  <span>{selected ? 'Selected' : 'Select'}</span>
                </button>
              );
            })}
          </section>

          <section className="ai-assistant-draft-actions">
            <button className="primary-button" type="button" onClick={copyAllSelected} disabled={selectedDrafts.length === 0}>
              <Copy size={16} aria-hidden="true" />
              Copy all selected
            </button>
            <button className="secondary-button" type="button" onClick={regenerateAllUneditedDrafts} disabled={generatedDrafts.length === 0}>
              Regenerate all unedited drafts
            </button>
            {copyStatus ? <span>{copyStatus}</span> : null}
          </section>

          <section className="ai-assistant-drafts" aria-label="Selected drafts">
            {selectedDrafts.map((draft) => (
              <article className="ai-assistant-draft" key={draft.channel}>
                <div className="ai-assistant-panel-heading">
                  <h2>{draft.channel}</h2>
                  <div className="ai-assistant-draft-buttons">
                    <span>{draftWorkspace.statuses[draft.channel] === 'edited' ? 'Edited' : 'Generated'}</span>
                    <button className="secondary-button compact" type="button" onClick={() => regenerateDraft(draft.channel)}>
                      Regenerate draft
                    </button>
                    <button className="secondary-button compact" type="button" onClick={() => copyDraft(draft.channel)}>
                      <Copy size={16} aria-hidden="true" />
                      Copy
                    </button>
                  </div>
                </div>
                <textarea
                  value={draftWorkspace.drafts[draft.channel] ?? draft.body}
                  onChange={(event) => {
                    setDraftWorkspace((current) => ({
                      drafts: { ...current.drafts, [draft.channel]: event.target.value },
                      statuses: { ...current.statuses, [draft.channel]: 'edited' },
                    }));
                  }}
                />
                <div className="ai-assistant-evidence-list" aria-label={`${draft.channel} evidence`}>
                  {draft.claims.map((claim) => (
                    <span key={`${draft.channel}-${claim.id}`}>{claim.label}: {claim.source}</span>
                  ))}
                </div>
              </article>
            ))}
          </section>
        </>
      ) : null}

      <p className="ai-assistant-phase-note">
        Drafts are deterministic and grounded in selected job data. No LLM calls, image recognition, publishing, OAuth, or database writes run here.
      </p>
    </section>
  );
}

async function copyText(text: string) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall back to the textarea path below.
  }

  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', 'true');
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand('copy');
    textarea.remove();
    return copied;
  } catch {
    return false;
  }
}
