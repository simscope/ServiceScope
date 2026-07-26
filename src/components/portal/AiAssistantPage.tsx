import { Bot, BriefcaseBusiness, CheckCircle2, Image, Lock, Video } from 'lucide-react';
import type { ServiceJob } from '../../types';
import { buildAssistantJobSummary, canOpenJobInAiAssistant, assistantMediaCounts } from '../../features/ai-assistant/assistantModel';

const assistantCapabilities = [
  'Instagram',
  'Facebook',
  'LinkedIn',
  'Google Business',
  'Blog / Case Study',
  'Short Video',
];

type AiAssistantPageProps = {
  selectedJob: ServiceJob | null;
};

export function AiAssistantPage({ selectedJob }: AiAssistantPageProps) {
  const summary = selectedJob ? buildAssistantJobSummary(selectedJob) : null;
  const mediaCounts = selectedJob ? assistantMediaCounts(selectedJob) : { photos: 0, videos: 0 };
  const unsupportedStatus = selectedJob && !canOpenJobInAiAssistant(selectedJob.status);

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
          {summary ? (
            <>
              <div className="ai-assistant-job-summary">
                <span>Status</span>
                <strong>{summary.status}</strong>
                <span>System</span>
                <strong>{summary.system}</strong>
              </div>
              <p className="ai-assistant-safe-description">{summary.description}</p>
              {unsupportedStatus ? (
                <p className="ai-assistant-status-note">
                  AI Assistant Phase 1 accepts Completed and Warranty jobs. This job is shown for context only.
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
        </section>

        <section className="ai-assistant-panel privacy">
          <div className="ai-assistant-panel-heading">
            <h2>Privacy</h2>
            <Lock size={18} aria-hidden="true" />
          </div>
          <p>
            Client names, addresses, phone numbers, emails, and private notes are excluded from assistant URLs and safe workspace summaries.
          </p>
        </section>
      </div>

      <section className="ai-assistant-capabilities" aria-label="Assistant channels">
        {assistantCapabilities.map((label) => (
          <article className="ai-assistant-capability disabled" key={label} aria-disabled="true">
            <CheckCircle2 size={18} aria-hidden="true" />
            <strong>{label}</strong>
            <span>Coming soon</span>
          </article>
        ))}
      </section>

      <p className="ai-assistant-phase-note">
        Live AI generation, API calls, publishing, OAuth, and platform connections arrive in later phases.
      </p>
    </section>
  );
}
