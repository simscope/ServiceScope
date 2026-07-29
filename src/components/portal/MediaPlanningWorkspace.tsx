import { useState, type DragEvent } from 'react';
import {
  ArrowDown,
  ArrowUp,
  EyeOff,
  Film,
  GripVertical,
  Image,
  Plus,
  RotateCcw,
  ShieldCheck,
  Trash2,
  Undo2,
} from 'lucide-react';
import type { AssistantMediaItem } from '../../features/ai-assistant/assistantModel';
import {
  movePlanningAttachment,
  movePlanningAttachmentByOffset,
  resetToSuggestedMediaOrder,
  setMediaPlanningInclusion,
  suggestedRoleLabel,
  updateMissingShotStatus,
  updateSceneOverlayText,
  type MediaPlanningState,
} from '../../features/media-planning/planningState';
import { attachmentUrl } from '../../features/job-attachments/jobAttachmentFiles';

type MediaPlanningWorkspaceProps = {
  state: MediaPlanningState;
  media: AssistantMediaItem[];
  privateValues: string[];
  onChange: (state: MediaPlanningState) => void;
};

export function MediaPlanningWorkspace({
  state,
  media,
  privateValues,
  onChange,
}: MediaPlanningWorkspaceProps) {
  const [draggingAttachmentId, setDraggingAttachmentId] = useState('');
  const [overlayErrors, setOverlayErrors] = useState<Record<string, string>>({});
  const mediaById = new Map(media.map((item) => [item.id, item]));
  const selected = new Set(state.selectedAttachmentIds);
  const availableMedia = state.eligibleMedia.filter((item) => !selected.has(item.attachmentId));
  const activeMissingShots = state.missingShotSuggestions.filter((item) => item.status !== 'dismissed');
  const dismissedMissingShots = state.missingShotSuggestions.filter((item) => item.status === 'dismissed');

  function handleDragStart(event: DragEvent<HTMLButtonElement>, attachmentId: string) {
    setDraggingAttachmentId(attachmentId);
    event.dataTransfer.setData('text/plain', attachmentId);
    event.dataTransfer.effectAllowed = 'move';
  }

  function handleDrop(event: DragEvent<HTMLElement>, targetIndex: number) {
    event.preventDefault();
    const attachmentId = event.dataTransfer.getData('text/plain') || draggingAttachmentId;
    if (!attachmentId) return;
    onChange(movePlanningAttachment(state, attachmentId, targetIndex));
    setDraggingAttachmentId('');
  }

  function updateOverlay(attachmentId: string, value: string) {
    const result = updateSceneOverlayText(state, attachmentId, value, privateValues);
    setOverlayErrors((current) => ({ ...current, [attachmentId]: result.error }));
    if (result.accepted) onChange(result.state);
  }

  return (
    <div className="ai-media-planning-workspace">
      <section className="ai-media-planning-section" aria-labelledby="carousel-plan-heading">
        <div className="ai-media-planning-heading">
          <div>
            <p className="eyebrow">Approved media only</p>
            <h2 id="carousel-plan-heading">Carousel Plan</h2>
          </div>
          <div className="ai-media-planning-summary" aria-label="Carousel plan summary">
            <span>{state.carouselSlots.length} selected</span>
            <span>Revision {state.revision}</span>
          </div>
        </div>

        {state.blockedAttachmentIds.length ? (
          <p className="ai-assistant-analysis-error">
            <ShieldCheck size={16} aria-hidden="true" />
            {state.blockedAttachmentIds.length} approved media item{state.blockedAttachmentIds.length === 1 ? '' : 's'} blocked by unresolved privacy review.
          </p>
        ) : null}

        <div className="ai-media-original-order" aria-label="Original attachment order">
          <strong>Original attachment order</strong>
          <ol>
            {state.originalAttachmentIds.map((attachmentId) => (
              <li key={attachmentId}>{mediaById.get(attachmentId)?.name ?? 'Attachment unavailable'}</li>
            ))}
          </ol>
        </div>

        <div className="ai-media-planning-toolbar">
          <button
            className="secondary-button compact"
            type="button"
            onClick={() => onChange(resetToSuggestedMediaOrder(state))}
            disabled={state.carouselSlots.length < 2}
          >
            <RotateCcw size={16} aria-hidden="true" />
            Reset to suggested order
          </button>
          <span>{state.manualOrder ? 'Manual order' : 'Suggested order'}</span>
        </div>

        <div className="ai-media-carousel-list">
          {state.carouselSlots.map((slot, index) => {
            const item = mediaById.get(slot.attachmentId);
            const previewUrl = item ? attachmentUrl(item) : '';
            return (
              <article
                className={`ai-media-carousel-row ${draggingAttachmentId === slot.attachmentId ? 'dragging' : ''}`}
                key={slot.attachmentId}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => handleDrop(event, index)}
              >
                <strong className="ai-media-position" aria-label={`Position ${slot.position}`}>{slot.position}</strong>
                {item?.kind === 'photo' && previewUrl ? (
                  <img src={previewUrl} alt={item.name} />
                ) : (
                  <div className="ai-media-plan-placeholder">{item?.kind === 'photo' ? 'Photo' : 'Media'}</div>
                )}
                <div className="ai-media-plan-copy">
                  <div>
                    <strong>{suggestedRoleLabel(slot.suggestedRole)}</strong>
                    <span><ShieldCheck size={14} aria-hidden="true" /> Privacy passed</span>
                  </div>
                  <p>{slot.explanation}</p>
                </div>
                <div className="ai-media-plan-controls">
                  <button
                    className="icon-button"
                    type="button"
                    draggable
                    aria-label={`Drag ${item?.name ?? `item ${slot.position}`}`}
                    title="Drag to reorder"
                    onDragStart={(event) => handleDragStart(event, slot.attachmentId)}
                    onDragEnd={() => setDraggingAttachmentId('')}
                  >
                    <GripVertical size={17} aria-hidden="true" />
                  </button>
                  <button
                    className="icon-button"
                    type="button"
                    aria-label={`Move ${item?.name ?? `item ${slot.position}`} up`}
                    title="Move up"
                    onClick={() => onChange(movePlanningAttachmentByOffset(state, slot.attachmentId, -1))}
                    disabled={index === 0}
                  >
                    <ArrowUp size={17} aria-hidden="true" />
                  </button>
                  <button
                    className="icon-button"
                    type="button"
                    aria-label={`Move ${item?.name ?? `item ${slot.position}`} down`}
                    title="Move down"
                    onClick={() => onChange(movePlanningAttachmentByOffset(state, slot.attachmentId, 1))}
                    disabled={index === state.carouselSlots.length - 1}
                  >
                    <ArrowDown size={17} aria-hidden="true" />
                  </button>
                  <button
                    className="icon-button"
                    type="button"
                    aria-label={`Remove ${item?.name ?? `item ${slot.position}`} from plan`}
                    title="Remove from plan"
                    onClick={() => onChange(setMediaPlanningInclusion(state, slot.attachmentId, false))}
                  >
                    <Trash2 size={17} aria-hidden="true" />
                  </button>
                </div>
              </article>
            );
          })}
          {!state.carouselSlots.length ? (
            <p className="empty-inline">Approve safe media in Media Findings Review to begin a plan.</p>
          ) : null}
        </div>

        {availableMedia.length ? (
          <div className="ai-media-available-list" aria-label="Approved media outside carousel">
            <strong>Approved media outside the plan</strong>
            {availableMedia.map((source) => {
              const item = mediaById.get(source.attachmentId);
              return (
                <div key={source.attachmentId}>
                  <span>{item?.name ?? 'Approved attachment'} / {suggestedRoleLabel(source.suggestedRole)}</span>
                  <button
                    className="secondary-button compact"
                    type="button"
                    onClick={() => onChange(setMediaPlanningInclusion(state, source.attachmentId, true))}
                  >
                    <Plus size={15} aria-hidden="true" />
                    Add to plan
                  </button>
                </div>
              );
            })}
          </div>
        ) : null}
      </section>

      <section className="ai-media-planning-section" aria-labelledby="missing-shots-heading">
        <div className="ai-media-planning-heading">
          <div>
            <p className="eyebrow">Optional suggestions</p>
            <h2 id="missing-shots-heading">Suggested Missing Shots</h2>
          </div>
          <Image size={20} aria-hidden="true" />
        </div>
        <div className="ai-media-missing-list">
          {activeMissingShots.map((suggestion) => (
            <article key={suggestion.id}>
              <div>
                <strong>{suggestion.text}</strong>
                <span>{suggestion.status === 'planned' ? 'Planned locally' : 'Not captured / Optional / Requires confirmation'}</span>
              </div>
              <div>
                {suggestion.status === 'suggested' ? (
                  <button
                    className="secondary-button compact"
                    type="button"
                    onClick={() => onChange(updateMissingShotStatus(state, suggestion.id, 'planned'))}
                  >
                    Mark planned
                  </button>
                ) : (
                  <button
                    className="secondary-button compact"
                    type="button"
                    onClick={() => onChange(updateMissingShotStatus(state, suggestion.id, 'suggested'))}
                  >
                    <Undo2 size={15} aria-hidden="true" />
                    Restore suggestion
                  </button>
                )}
                <button
                  className="icon-button"
                  type="button"
                  aria-label={`Dismiss suggestion: ${suggestion.text}`}
                  title="Dismiss suggestion"
                  onClick={() => onChange(updateMissingShotStatus(state, suggestion.id, 'dismissed'))}
                >
                  <EyeOff size={16} aria-hidden="true" />
                </button>
              </div>
            </article>
          ))}
          {!activeMissingShots.length ? <p className="empty-inline">No active missing-shot suggestions.</p> : null}
        </div>
        {dismissedMissingShots.length ? (
          <div className="ai-media-dismissed-suggestions">
            <strong>Dismissed suggestions</strong>
            {dismissedMissingShots.map((suggestion) => (
              <button
                className="secondary-button compact"
                type="button"
                key={suggestion.id}
                onClick={() => onChange(updateMissingShotStatus(state, suggestion.id, 'suggested'))}
              >
                <Undo2 size={15} aria-hidden="true" />
                Restore
              </button>
            ))}
          </div>
        ) : null}
      </section>

      <section className="ai-media-planning-section" aria-labelledby="video-plan-heading">
        <div className="ai-media-planning-heading">
          <div>
            <p className="eyebrow">Text plan only</p>
            <h2 id="video-plan-heading">Short-Video Scene Plan</h2>
          </div>
          <Film size={20} aria-hidden="true" />
        </div>
        <div className="ai-media-scene-list">
          {state.shortVideoScenes.map((scene) => {
            const item = mediaById.get(scene.attachmentId);
            return (
              <article key={scene.attachmentId}>
                <strong className="ai-media-position" aria-label={`Scene ${scene.position}`}>{scene.position}</strong>
                <div className="ai-media-scene-copy">
                  <strong>{suggestedRoleLabel(scene.sceneRole)}</strong>
                  <span>{item?.name ?? 'Approved attachment'}</span>
                  <span>Evidence: {scene.evidenceFindingId ?? 'approved media only'}</span>
                  <span><ShieldCheck size={14} aria-hidden="true" /> Privacy passed</span>
                </div>
                <label>
                  Optional overlay text
                  <textarea
                    value={scene.overlayText}
                    maxLength={140}
                    onChange={(event) => updateOverlay(scene.attachmentId, event.target.value)}
                    aria-invalid={Boolean(overlayErrors[scene.attachmentId])}
                  />
                </label>
                {overlayErrors[scene.attachmentId] ? (
                  <p className="ai-assistant-analysis-error">{overlayErrors[scene.attachmentId]}</p>
                ) : null}
              </article>
            );
          })}
          {!state.shortVideoScenes.length ? <p className="empty-inline">Add approved media to the carousel to build scenes.</p> : null}
        </div>
      </section>
    </div>
  );
}
