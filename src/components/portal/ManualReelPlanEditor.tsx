import { CheckCircle2, X } from 'lucide-react';
import {
  MANUAL_REEL_CATEGORY_OPTIONS,
  MANUAL_REEL_PRIMARY_MAX_LENGTH,
  MANUAL_REEL_SUPPORTING_MAX_LENGTH,
  applyManualReelDraft,
} from '../../features/reel-director/manualPlan';
import type {
  ManualReelSceneInput,
  ReelCreativePlanV1,
  ReelSceneCategoryLabel,
} from '../../features/reel-director/contracts';
import { ReelPreview } from './ReelPreview';

type ManualReelPlanEditorProps = {
  plan: ReelCreativePlanV1;
  scenes: ManualReelSceneInput[];
  mediaUrls: Map<string, { url: string; alt: string }>;
  pending: boolean;
  error: string;
  onChange: (scenes: ManualReelSceneInput[]) => void;
  onCreate: () => void;
  onCancel: () => void;
};

export function ManualReelPlanEditor({
  plan,
  scenes,
  mediaUrls,
  pending,
  error,
  onChange,
  onCreate,
  onCancel,
}: ManualReelPlanEditorProps) {
  const preview = applyManualReelDraft(plan, scenes);

  function updateScene(position: number, patch: Partial<ManualReelSceneInput>) {
    onChange(scenes.map((scene) => scene.position === position ? { ...scene, ...patch } : scene));
  }

  return (
    <section className="manual-reel-editor" aria-label="Simple Reel plan editor">
      <div className="manual-reel-editor-heading">
        <div>
          <span>Selected media plan</span>
          <h3>Review the story before creating the plan</h3>
        </div>
        <button className="icon-button" type="button" onClick={onCancel} aria-label="Close plan editor" title="Close plan editor">
          <X size={18} aria-hidden="true" />
        </button>
      </div>
      <div className="manual-reel-editor-layout">
        <ReelPreview plan={preview} mediaUrls={mediaUrls} />
        <div className="manual-reel-scene-list">
          {scenes.map((scene) => (
            <fieldset className="manual-reel-scene" key={scene.attachmentId}>
              <legend>Scene {scene.position}</legend>
              <label>
                Category
                <select
                  value={scene.categoryLabel}
                  onChange={(event) => updateScene(scene.position, { categoryLabel: event.target.value as ReelSceneCategoryLabel })}
                >
                  {MANUAL_REEL_CATEGORY_OPTIONS[scene.role].map((category) => <option key={category} value={category}>{category}</option>)}
                </select>
              </label>
              <label>
                Primary text
                <input
                  value={scene.primaryText}
                  maxLength={MANUAL_REEL_PRIMARY_MAX_LENGTH}
                  onChange={(event) => updateScene(scene.position, { primaryText: event.target.value })}
                />
              </label>
              <label>
                Supporting line
                <input
                  value={scene.supportingText}
                  maxLength={MANUAL_REEL_SUPPORTING_MAX_LENGTH}
                  placeholder="Optional"
                  onChange={(event) => updateScene(scene.position, { supportingText: event.target.value })}
                />
              </label>
            </fieldset>
          ))}
          {error ? <p className="ai-assistant-analysis-error" role="alert">{error}</p> : null}
          <div className="manual-reel-editor-actions">
            <button className="primary-button" type="button" onClick={onCreate} disabled={pending}>
              <CheckCircle2 size={18} aria-hidden="true" />
              {pending ? 'Creating plan' : 'Create Reel Plan'}
            </button>
            <button className="secondary-button" type="button" onClick={onCancel} disabled={pending}>Cancel</button>
          </div>
        </div>
      </div>
    </section>
  );
}
