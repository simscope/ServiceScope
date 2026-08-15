import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Bot, BriefcaseBusiness, CheckCircle2, Copy, Download, Film, Image, Lock, RotateCcw, SlidersHorizontal, Sparkles, Video } from 'lucide-react';
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
import { generateAiContent } from '../../features/content-engine/clientApi';
import type { AssistantTone, ContentGenerationResult } from '../../features/content-engine/contracts';
import { analyzeSelectedMedia } from '../../features/media-analysis/clientApi';
import {
  MEDIA_ANALYSIS_ERROR_MESSAGES,
  MEDIA_ANALYSIS_MAX_PHOTOS,
  isPrivacyFinding,
  normalizeMediaAnalysisError,
  privacyRiskPriority,
  validateMediaAnalysisSelection,
  type MediaAnalysisAttachmentResult,
  type MediaAnalysisFinding,
  type MediaAnalysisResult,
} from '../../features/media-analysis/contracts';
import {
  applyMediaAnalysisError,
  applyMediaAnalysisResult,
  beginMediaAnalysisRequest,
  createMediaAnalysisWorkspaceState,
  mediaStatusLabel,
  mediaStatusMessage,
  setMediaApproval,
  type MediaReviewApprovalState,
} from '../../features/media-analysis/workspaceState';
import {
  createMediaPlanningState,
  reconcileMediaPlanningState,
} from '../../features/media-planning/planningState';
import { MediaPlanningWorkspace } from './MediaPlanningWorkspace';
import { FacebookPublishPanel } from './FacebookPublishPanel';
import {
  approveFacebookPublicationPhoto,
  excludeFacebookPublicationPhoto,
  resolveFacebookPublicationPhotoFalsePositive,
  revokeFacebookPublicationPhotoApproval,
} from '../../features/meta-publishing/clientApi';
import { loadCompanyVoiceSummary } from '../../features/company-voice/clientApi';
import {
  buildGenerationPreferencesByChannel,
  resetChannelGenerationPreference,
  updateChannelGenerationPreference,
  type CompanyVoiceSummary,
} from '../../features/company-voice/contracts';
import { generateAiReel } from '../../features/reel-director/clientApi';
import { reelErrorMessage } from '../../features/reel-director/contracts';
import { runOneClickReel } from '../../features/reel-director/oneClickReel';
import {
  applyReelPlan,
  approveCurrentReel,
  createReelWorkspaceState,
  isCurrentReelApproved,
  reconcileReelApproval,
  reelInputRevision,
  reelMediaPlan,
  reelStatusLabel,
} from '../../features/reel-director/reelState';
import { ReelPreview } from './ReelPreview';
import {
  approveReelPlan,
  beginReelRender,
  loadPersistedReelWorkspace,
  loadReelArtifacts,
} from '../../features/reel-render-jobs/clientApi';
import { shouldRecoverReelDispatch } from '../../features/reel-render-jobs/dispatchRecovery';
import { renderErrorMessage, type PersistedReelWorkspace, type ReelRenderWorkspace } from '../../features/reel-render-jobs/contracts';
import {
  idleReelRender,
  isReelAsyncScopeCurrent,
  isReelRenderForPlan,
  persistedReelPlanIdentity,
  reconcileReelRenderForPlan,
  reelPlanIdentity,
  sameReelPlanIdentity,
} from '../../features/reel-render-jobs/renderState.js';

const mediaLabels: AssistantMediaLabel[] = ['Overview', 'Problem', 'Repair', 'Part', 'Result'];
const assistantTones: AssistantTone[] = ['Professional', 'Friendly', 'Technical', 'Educational', 'Marketing'];
const disabledCompanyVoiceSummary: CompanyVoiceSummary = {
  enabled: false,
  defaultTone: 'Professional',
  channelDefaults: {},
};

type AiAssistantPageProps = {
  companyId: string;
  selectedJob: ServiceJob | null;
  materials: MaterialRow[];
};

function renderWorkspaceFromSaved(saved: PersistedReelWorkspace): ReelRenderWorkspace {
  return {
    creativePlanId: saved.creative_plan_id,
    planRevision: saved.plan_revision,
    renderJobId: saved.render_job_id ?? undefined,
    status: saved.render_status ?? 'idle',
    errorCode: saved.render_error_code ?? undefined,
    durationMs: saved.duration_ms ?? undefined,
    width: saved.width ?? undefined,
    height: saved.height ?? undefined,
  };
}

export function AiAssistantPage({ companyId, selectedJob, materials }: AiAssistantPageProps) {
  const [selectedChannels, setSelectedChannels] = useState<AssistantChannel[]>(['Instagram']);
  const [localFacts, setLocalFacts] = useState<AssistantLocalFacts>({});
  const [mediaState, setMediaState] = useState<AssistantMediaState[]>([]);
  const [draftWorkspace, setDraftWorkspace] = useState<AssistantDraftWorkspaceState>({ drafts: {}, statuses: {} });
  const [copyStatus, setCopyStatus] = useState('');
  const [activeGenerationChannel, setActiveGenerationChannel] = useState<AssistantChannel>('Instagram');
  const [generationPreferencesByChannel, setGenerationPreferencesByChannel] = useState(
    () => buildGenerationPreferencesByChannel(disabledCompanyVoiceSummary),
  );
  const [companyVoiceSummary, setCompanyVoiceSummary] = useState<CompanyVoiceSummary>(disabledCompanyVoiceSummary);
  const [aiStatusByChannel, setAiStatusByChannel] = useState<Partial<Record<AssistantChannel, string>>>({});
  const [aiPendingChannel, setAiPendingChannel] = useState<AssistantChannel | null>(null);
  const [mediaAnalysisWorkspace, setMediaAnalysisWorkspace] = useState(() => createMediaAnalysisWorkspaceState(selectedJob?.id));
  const [mediaPlanningState, setMediaPlanningState] = useState(() => createMediaPlanningState(selectedJob?.id));
  const [reelWorkspace, setReelWorkspace] = useState(() => createReelWorkspaceState(selectedJob?.id));
  const [reelRender, setReelRender] = useState<ReelRenderWorkspace>({ status: 'idle' });
  const reelDispatchRecoveryAtRef = useRef(new Map<string, number>());
  const selectedJobIdRef = useRef(selectedJob?.id);
  const reelPlanScopeRef = useRef({
    jobId: selectedJob?.id,
    creativePlanId: undefined as string | undefined,
    planRevision: undefined as string | undefined,
    epoch: 0,
  });
  const [reelEditOpen, setReelEditOpen] = useState(false);
  const [facebookStatusRefreshToken, setFacebookStatusRefreshToken] = useState(0);
  const activeReelPlanIdentity = reelPlanIdentity(
    reelWorkspace.creativePlanId ?? reelWorkspace.plan?.creativePlanId,
    reelWorkspace.plan?.revision,
  );
  const activeReelRender = reconcileReelRenderForPlan(reelRender, activeReelPlanIdentity) as ReelRenderWorkspace;

  useEffect(() => {
    let active = true;
    setActiveGenerationChannel('Instagram');
    setCompanyVoiceSummary(disabledCompanyVoiceSummary);
    setGenerationPreferencesByChannel(buildGenerationPreferencesByChannel(disabledCompanyVoiceSummary));
    loadCompanyVoiceSummary(companyId)
      .then((summary) => {
        if (!active) return;
        setCompanyVoiceSummary(summary);
        setGenerationPreferencesByChannel(buildGenerationPreferencesByChannel(summary));
      })
      .catch(() => {
        if (!active) return;
        setCompanyVoiceSummary(disabledCompanyVoiceSummary);
        setGenerationPreferencesByChannel(buildGenerationPreferencesByChannel(disabledCompanyVoiceSummary));
      });
    return () => {
      active = false;
    };
  }, [companyId]);

  useEffect(() => {
    selectedJobIdRef.current = selectedJob?.id;
    reelPlanScopeRef.current = {
      jobId: selectedJob?.id,
      creativePlanId: undefined,
      planRevision: undefined,
      epoch: reelPlanScopeRef.current.epoch + 1,
    };
    setLocalFacts({});
    setMediaState([]);
    setDraftWorkspace({ drafts: {}, statuses: {} });
    setCopyStatus('');
    setAiStatusByChannel({});
    setAiPendingChannel(null);
    setMediaAnalysisWorkspace(createMediaAnalysisWorkspaceState(selectedJob?.id));
    setMediaPlanningState(createMediaPlanningState(selectedJob?.id));
    setReelWorkspace(createReelWorkspaceState(selectedJob?.id));
    setReelRender({ status: 'idle' });
    reelDispatchRecoveryAtRef.current.clear();
    setReelEditOpen(false);
    setFacebookStatusRefreshToken((current) => current + 1);
  }, [selectedJob?.id]);

  useEffect(() => {
    let active = true;
    if (!selectedJob?.id) return () => { active = false; };
    const startedScope = { ...reelPlanScopeRef.current };
    loadPersistedReelWorkspace(selectedJob.id).then(async (saved) => {
      if (!active || !saved || !isReelAsyncScopeCurrent(startedScope, reelPlanScopeRef.current)) return;
      const savedIdentity = persistedReelPlanIdentity(saved);
      if (reelPlanScopeRef.current.creativePlanId && !sameReelPlanIdentity(reelPlanScopeRef.current, savedIdentity)) return;
      const activeScope = activateReelPlanScope(savedIdentity);
      const plan = { ...saved.plan_json, creativePlanId: saved.creative_plan_id };
      setReelWorkspace((current) => ({ ...current, status: 'reel_ready', plan, creativePlanId: saved.creative_plan_id, inputRevision: saved.plan_revision, error: '' }));
      if (saved.render_job_id && saved.render_status) {
        const next = renderWorkspaceFromSaved(saved);
        setReelRender(next);
        void recoverQueuedReelDispatch(saved, activeScope);
        if (saved.artifact_available) {
          const artifact = await loadReelArtifacts(saved.render_job_id);
          if (!active || !isReelAsyncScopeCurrent(activeScope, reelPlanScopeRef.current)) return;
          setReelRender((current) => current.renderJobId === saved.render_job_id && isReelRenderForPlan(current, savedIdentity)
            ? { ...current, videoUrl: artifact.videoUrl, coverUrl: artifact.coverUrl, artifactExpiresAt: artifact.expiresAt }
            : current);
        }
      } else {
        setReelRender(idleReelRender(savedIdentity));
      }
    }).catch(() => {});
    return () => { active = false; };
  }, [selectedJob?.id]);

  useEffect(() => {
    if (!selectedJob?.id || !['queued', 'rendering'].includes(activeReelRender.status)) return;
    const timer = window.setInterval(() => {
      const startedScope = { ...reelPlanScopeRef.current };
      loadPersistedReelWorkspace(selectedJob.id).then(async (saved) => {
        if (!saved?.render_job_id || !saved.render_status || !isReelAsyncScopeCurrent(startedScope, reelPlanScopeRef.current)) return;
        const savedIdentity = persistedReelPlanIdentity(saved);
        if (!sameReelPlanIdentity(startedScope, savedIdentity)) return;
        const next = renderWorkspaceFromSaved(saved);
        setReelRender(next);
        void recoverQueuedReelDispatch(saved, startedScope);
        if (saved.artifact_available) {
          const artifact = await loadReelArtifacts(saved.render_job_id);
          if (!isReelAsyncScopeCurrent(startedScope, reelPlanScopeRef.current)) return;
          setReelRender((current) => current.renderJobId === saved.render_job_id && isReelRenderForPlan(current, savedIdentity)
            ? { ...current, videoUrl: artifact.videoUrl, coverUrl: artifact.coverUrl, artifactExpiresAt: artifact.expiresAt }
            : current);
        }
      }).catch(() => {});
    }, 4000);
    return () => window.clearInterval(timer);
  }, [selectedJob?.id, activeReelRender.status, activeReelRender.creativePlanId, activeReelRender.planRevision]);

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
  const selectedMediaCount = selectedMediaIds.size;
  const selectedPhotoCount = assistantContext?.publicSafe.media.filter((item) => item.selected && item.kind === 'photo').length ?? 0;
  const facebookPhotoCatalog = selectedMediaAttachments
    .filter((attachment) => attachment.kind === 'photo' && ['image/jpeg', 'image/png'].includes(attachment.mimeType.toLowerCase()))
    .map((attachment) => ({
      attachmentId: attachment.id,
      displayName: attachment.name,
      previewUrl: attachmentUrl(attachment),
      mimeType: attachment.mimeType.toLowerCase() === 'image/png' ? 'image/png' as const : 'image/jpeg' as const,
    }))
    .filter((attachment) => attachment.previewUrl);
  const attachmentById = useMemo(
    () => new Map((selectedJob?.attachments ?? []).map((attachment) => [attachment.id, attachment])),
    [selectedJob],
  );
  const assistantMediaById = useMemo(
    () => new Map((assistantContext?.publicSafe.media ?? []).map((item) => [item.id, item])),
    [assistantContext?.publicSafe.media],
  );
  const analysisResultAttachments = mediaAnalysisWorkspace.result?.attachments ?? [];
  const originalPlanningAttachmentIds = useMemo(() => {
    const assistantMediaIds = new Set(assistantContext?.publicSafe.media.map((item) => item.id) ?? []);
    return (selectedJob?.attachments ?? [])
      .map((attachment) => attachment.id)
      .filter((attachmentId) => assistantMediaIds.has(attachmentId));
  }, [assistantContext?.publicSafe.media, selectedJob?.attachments]);

  useEffect(() => {
    setMediaPlanningState((current) => reconcileMediaPlanningState(current, {
      jobId: selectedJob?.id,
      originalAttachmentIds: originalPlanningAttachmentIds,
      result: mediaAnalysisWorkspace.result,
      approvals: mediaAnalysisWorkspace.approvals,
    }));
  }, [
    selectedJob?.id,
    originalPlanningAttachmentIds,
    mediaAnalysisWorkspace.result,
    mediaAnalysisWorkspace.approvals,
  ]);

  const excludedReelAttachmentIds = useMemo(
    () => Object.entries(mediaAnalysisWorkspace.approvals)
      .filter(([, approval]) => approval === 'excluded')
      .map(([attachmentId]) => attachmentId)
      .sort(),
    [mediaAnalysisWorkspace.approvals],
  );

  const currentReelInputRevision = useMemo(() => reelInputRevision({
    jobId: selectedJob?.id,
    localFacts,
    media: assistantContext?.publicSafe.media ?? [],
    planning: mediaPlanningState,
    analysis: mediaAnalysisWorkspace.result,
    excludedAttachmentIds: excludedReelAttachmentIds,
    companyVoiceRevision: JSON.stringify(companyVoiceSummary),
  }), [selectedJob?.id, localFacts, assistantContext?.publicSafe.media, mediaPlanningState, mediaAnalysisWorkspace.result, excludedReelAttachmentIds, companyVoiceSummary]);
  const currentReelMediaPlan = useMemo(
    () => reelMediaPlan(assistantContext?.publicSafe.media ?? [], mediaPlanningState, excludedReelAttachmentIds),
    [assistantContext?.publicSafe.media, mediaPlanningState, excludedReelAttachmentIds],
  );
  const reelMediaUrls = useMemo(() => new Map(
    (selectedJob?.attachments ?? []).flatMap((attachment) => {
      const url = attachmentUrl(attachment);
      return url ? [[attachment.id, { url, alt: attachment.name || 'Approved job media' }] as const] : [];
    }),
  ), [selectedJob?.attachments]);
  const reelApproved = isCurrentReelApproved(reelWorkspace, currentReelInputRevision);
  useEffect(() => {
    selectedJobIdRef.current = selectedJob?.id;
    setReelWorkspace((current) => reconcileReelApproval(current, currentReelInputRevision));
  }, [selectedJob?.id, currentReelInputRevision]);

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

  function resetGenerationDefaults() {
    setGenerationPreferencesByChannel((current) => (
      resetChannelGenerationPreference(current, companyVoiceSummary, activeGenerationChannel)
    ));
  }

  function updateActiveGenerationPreference(patch: { tone?: AssistantTone; locale?: string }) {
    setGenerationPreferencesByChannel((current) => (
      updateChannelGenerationPreference(current, activeGenerationChannel, patch)
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

  async function generateChannelWithAi(channel: AssistantChannel) {
    if (!selectedJob || !assistantContext || aiPendingChannel) return;
    const requestJobId = selectedJob.id;
    const preferences = generationPreferencesByChannel[channel];
    setAiPendingChannel(channel);
    setAiStatusByChannel((current) => ({ ...current, [channel]: 'Generating with AI...' }));
    try {
      const result = await generateAiContent({
        jobId: requestJobId,
        channel,
        tone: preferences.tone,
        locale: preferences.locale,
        localFacts,
        mediaState,
        idempotencyKey: `${requestJobId}:${channel}:${Date.now()}:${crypto.randomUUID()}`,
      });
      if (selectedJob.id !== requestJobId) return;
      setDraftWorkspace((current) => ({
        drafts: { ...current.drafts, [channel]: contentResultToDraftText(result) },
        statuses: { ...current.statuses, [channel]: 'generated' },
      }));
      const providerLabel = result.provider === 'deterministic-fallback' ? 'Deterministic fallback' : `AI provider: ${result.provider}`;
      const warningText = result.warnings.length ? ` ${result.warnings.map((warning) => warning.message).join(' ')}` : '';
      setAiStatusByChannel((current) => ({ ...current, [channel]: `${providerLabel}.${warningText}`.trim() }));
    } catch (error) {
      setAiStatusByChannel((current) => ({
        ...current,
        [channel]: error instanceof Error ? error.message : 'AI generation failed. Existing draft was kept.',
      }));
    } finally {
      setAiPendingChannel((current) => (current === channel ? null : current));
    }
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

  async function runMediaAnalysis(attachmentIds: string[]): Promise<MediaAnalysisResult> {
    if (!selectedJob) throw new Error('MEDIA_NOT_FOUND');
    const requestJobId = selectedJob.id;
    const requestId = `${requestJobId}:media:${Date.now()}:${crypto.randomUUID()}`;
    const started = beginMediaAnalysisRequest(mediaAnalysisWorkspace, requestId);
    if (!started.shouldRequest) throw new Error('MEDIA_PROVIDER_UNAVAILABLE');
    setMediaAnalysisWorkspace(started.state);

    try {
      const result = await analyzeSelectedMedia({ jobId: requestJobId, attachmentIds, idempotencyKey: requestId });
      setMediaAnalysisWorkspace((current) => applyMediaAnalysisResult(current, result, requestId, requestJobId));
      setFacebookStatusRefreshToken((current) => current + 1);
      return result;
    } catch (error) {
      const normalized = normalizeMediaAnalysisError(error);
      setMediaAnalysisWorkspace((current) => applyMediaAnalysisError(current, normalized.message, requestId));
      throw new Error(`${normalized.code}: ${normalized.message}`);
    }
  }

  async function analyzeMedia() {
    if (!selectedJob || !assistantContext || mediaAnalysisWorkspace.status === 'pending') return;
    const selection = validateMediaAnalysisSelection(assistantContext.publicSafe.media);
    if (!selection.ok) {
      setMediaAnalysisWorkspace((current) => ({
        ...current,
        status: 'failed',
        error: MEDIA_ANALYSIS_ERROR_MESSAGES[selection.code],
      }));
      return;
    }

    try {
      await runMediaAnalysis(selection.attachmentIds);
    } catch {
      // runMediaAnalysis records the safe workspace error.
    }
  }

  async function generateReel() {
    if (!selectedJob || !assistantContext || unsupportedStatus || ['analyzing', 'creating_story'].includes(reelWorkspace.status)) return;
    const requestJobId = selectedJob.id;
    const mediaPlan = currentReelMediaPlan;
    if (!mediaPlan.length) {
      setReelWorkspace((current) => ({ ...current, status: 'failed', error: 'Select at least one supported job photo.', approvedRevision: undefined }));
      return;
    }
    setReelWorkspace((current) => ({
      ...current,
      status: 'creating_story',
      error: '',
      approvalInvalidated: Boolean(current.approvedRevision || current.approvalInvalidated),
      approvedRevision: undefined,
    }));
    try {
      const workflow = await runOneClickReel({
        mediaPlan,
        currentAnalysis: mediaAnalysisWorkspace.result,
        analyze: runMediaAnalysis,
        privacyReviewCount: (analysis) => unresolvedPrivacyAttachmentCount(
          analysis,
          mediaPlan.map((item) => item.attachmentId),
          mediaAnalysisWorkspace.approvals,
        ),
        onStage: (status) => setReelWorkspace((current) => ({ ...current, status })),
        generate: async (analysisResult) => {
          const requestRevision = reelInputRevision({
            jobId: requestJobId,
            localFacts,
            media: assistantContext.publicSafe.media,
            planning: mediaPlanningState,
            analysis: analysisResult,
            excludedAttachmentIds: excludedReelAttachmentIds,
            companyVoiceRevision: JSON.stringify(companyVoiceSummary),
          });
          const plan = await generateAiReel({
            jobId: requestJobId,
            locale: generationPreferencesByChannel['Short Video'].locale,
            localFacts,
            mediaPlan,
            planningRevision: requestRevision,
            idempotencyKey: `${requestJobId}:reel:${Date.now()}:${crypto.randomUUID()}`,
          });
          return { plan, requestRevision };
        },
      });
      if (workflow.kind === 'privacy_review_required') {
        setReelWorkspace((current) => ({
          ...current,
          status: 'privacy_review_required',
          error: `${workflow.count} photo${workflow.count === 1 ? '' : 's'} need privacy review before AI Reel can use them.`,
          approvedRevision: undefined,
        }));
        return;
      }
      if (selectedJobIdRef.current !== requestJobId) return;
      const nextIdentity = reelPlanIdentity(workflow.value.plan.creativePlanId, workflow.value.plan.revision);
      const previousScope = reelPlanScopeRef.current;
      activateReelPlanScope(nextIdentity);
      setReelWorkspace((current) => applyReelPlan(current, workflow.value.plan, workflow.value.requestRevision));
      if (!sameReelPlanIdentity(previousScope, nextIdentity)) {
        setReelRender((current) => {
          if (current.renderJobId) reelDispatchRecoveryAtRef.current.delete(current.renderJobId);
          return idleReelRender(nextIdentity);
        });
      }
    } catch (error) {
      const message = reelErrorMessage(error);
      if (String(error).includes('REEL_PRIVACY_REVIEW_REQUIRED')) {
        setReelWorkspace((current) => ({ ...current, status: 'privacy_review_required', error: message, approvedRevision: undefined }));
      } else {
        setReelWorkspace((current) => ({ ...current, status: 'failed', error: message, approvedRevision: undefined }));
      }
    }
  }

  async function createMp4() {
    const creativePlanId = reelWorkspace.creativePlanId ?? reelWorkspace.plan?.creativePlanId;
    const revision = reelWorkspace.plan?.revision;
    const identity = reelPlanIdentity(creativePlanId, revision);
    const startedScope = { ...reelPlanScopeRef.current };
    if (!creativePlanId || !revision || !reelApproved || !sameReelPlanIdentity(startedScope, identity) || ['queued', 'rendering'].includes(activeReelRender.status)) return;
    try {
      const result = await beginReelRender(creativePlanId, revision);
      if (!isReelAsyncScopeCurrent(startedScope, reelPlanScopeRef.current)) return;
      setReelRender({ ...identity, renderJobId: result.renderJobId, status: result.status, errorCode: result.errorCode ?? undefined });
    } catch (error) {
      if (!isReelAsyncScopeCurrent(startedScope, reelPlanScopeRef.current)) return;
      const code = error instanceof Error ? error.message : 'REEL_RENDER_FAILED';
      if (code === 'REEL_RENDER_DISPATCH_FAILED' && selectedJob?.id) {
        const saved = await loadPersistedReelWorkspace(selectedJob.id).catch(() => null);
        if (!isReelAsyncScopeCurrent(startedScope, reelPlanScopeRef.current)) return;
        if (saved?.render_job_id && saved.render_status === 'queued' && sameReelPlanIdentity(identity, persistedReelPlanIdentity(saved))) {
          reelDispatchRecoveryAtRef.current.set(saved.render_job_id, Date.now());
          setReelRender({ ...identity, renderJobId: saved.render_job_id, status: 'queued', errorCode: code });
          return;
        }
      }
      setReelRender({ ...identity, status: code === 'REEL_RENDER_NOT_CONFIGURED' ? 'not_configured' : 'failed', errorCode: code });
    }
  }

  async function approveReelForRendering() {
    const creativePlanId = reelWorkspace.creativePlanId ?? reelWorkspace.plan?.creativePlanId;
    const revision = reelWorkspace.plan?.revision;
    const identity = reelPlanIdentity(creativePlanId, revision);
    const startedScope = { ...reelPlanScopeRef.current };
    if (!creativePlanId || !revision || !sameReelPlanIdentity(startedScope, identity)) return;
    try {
      await approveReelPlan(creativePlanId, revision);
      if (!isReelAsyncScopeCurrent(startedScope, reelPlanScopeRef.current)) return;
      setReelWorkspace((current) => approveCurrentReel(current, currentReelInputRevision));
    } catch (error) {
      if (!isReelAsyncScopeCurrent(startedScope, reelPlanScopeRef.current)) return;
      setReelWorkspace((current) => ({
        ...current,
        approvedRevision: undefined,
        error: renderErrorMessage(error instanceof Error ? error.message : 'REEL_RENDER_FAILED'),
      }));
    }
  }

  async function recoverQueuedReelDispatch(
    saved: Awaited<ReturnType<typeof loadPersistedReelWorkspace>>,
    scope = reelPlanScopeRef.current,
  ) {
    if (!saved?.render_job_id || !shouldRecoverReelDispatch(
      saved,
      reelDispatchRecoveryAtRef.current.get(saved.render_job_id),
    ) || !isReelAsyncScopeCurrent(scope, reelPlanScopeRef.current)
      || !sameReelPlanIdentity(scope, persistedReelPlanIdentity(saved))) return;
    reelDispatchRecoveryAtRef.current.set(saved.render_job_id, Date.now());
    await beginReelRender(saved.creative_plan_id, saved.plan_revision).catch(() => undefined);
  }

  async function refreshReelArtifacts() {
    if (!activeReelRender.renderJobId) return;
    const startedScope = { ...reelPlanScopeRef.current };
    const renderJobId = activeReelRender.renderJobId;
    try {
      const artifact = await loadReelArtifacts(renderJobId);
      if (!isReelAsyncScopeCurrent(startedScope, reelPlanScopeRef.current)) return;
      setReelRender((current) => current.renderJobId === renderJobId && isReelRenderForPlan(current, startedScope)
        ? { ...current, videoUrl: artifact.videoUrl, coverUrl: artifact.coverUrl, artifactExpiresAt: artifact.expiresAt }
        : current);
    } catch (error) {
      if (!isReelAsyncScopeCurrent(startedScope, reelPlanScopeRef.current)) return;
      const code = error instanceof Error ? error.message : 'REEL_RENDER_FAILED';
      setReelRender((current) => current.renderJobId === renderJobId && isReelRenderForPlan(current, startedScope)
        ? { ...current, errorCode: code }
        : current);
    }
  }

  function activateReelPlanScope(identity: { creativePlanId?: string; planRevision?: string }) {
    const current = reelPlanScopeRef.current;
    if (current.jobId === selectedJobIdRef.current && sameReelPlanIdentity(current, identity)) return current;
    const next = {
      jobId: selectedJobIdRef.current,
      creativePlanId: identity.creativePlanId,
      planRevision: identity.planRevision,
      epoch: current.epoch + 1,
    };
    reelPlanScopeRef.current = next;
    return next;
  }

  async function updateMediaApproval(attachmentId: string, approval: MediaReviewApprovalState) {
    if (!selectedJob) return;
    const result = mediaAnalysisWorkspace.result?.attachments.find((item) => item.id === attachmentId);
    if (!result || result.kind !== 'photo') {
      setMediaAnalysisWorkspace((current) => setMediaApproval(current, attachmentId, approval));
      return;
    }
    try {
      if (approval === 'approved') {
        if (!result.analysisRunId || !result.attachmentResultId) return;
        await approveFacebookPublicationPhoto({
          companyId,
          jobId: selectedJob.id,
          attachmentId,
          analysisRunId: result.analysisRunId,
          attachmentResultId: result.attachmentResultId,
          explicitApproval: true,
          approvalReason: 'Approved in AI Assistant media review.',
        });
      } else if (approval === 'excluded') {
        if (!result.analysisRunId || !result.attachmentResultId) return;
        await excludeFacebookPublicationPhoto({
          companyId,
          jobId: selectedJob.id,
          attachmentId,
          analysisRunId: result.analysisRunId,
          attachmentResultId: result.attachmentResultId,
          explicitApproval: true,
          exclusionReason: 'Excluded in AI Assistant media review.',
        });
      } else if (approval === 'false_positive') {
        if (!result.analysisRunId || !result.attachmentResultId) return;
        const findingIds = result.findings.filter((finding) => isPrivacyFinding(finding.category)).map((finding) => finding.findingId);
        if (findingIds.length === 0) return;
        await resolveFacebookPublicationPhotoFalsePositive({
          companyId,
          jobId: selectedJob.id,
          attachmentId,
          analysisRunId: result.analysisRunId,
          attachmentResultId: result.attachmentResultId,
          findingIds,
          explicitApproval: true,
          resolutionReason: 'Marked false positive in AI Assistant media review.',
        });
      } else {
        await revokeFacebookPublicationPhotoApproval({
          companyId,
          jobId: selectedJob.id,
          attachmentId,
          explicitApproval: true,
          revocationReason: `Media review changed to ${approval}.`,
        });
      }
      setMediaAnalysisWorkspace((current) => setMediaApproval(current, attachmentId, approval));
      setFacebookStatusRefreshToken((current) => current + 1);
    } catch {
      setMediaAnalysisWorkspace((current) => setMediaApproval(current, attachmentId, 'pending'));
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
          <button
            className="secondary-button compact"
            type="button"
            onClick={analyzeMedia}
            disabled={selectedMediaCount === 0 || mediaAnalysisWorkspace.status === 'pending'}
          >
            <Image size={16} aria-hidden="true" />
            {mediaAnalysisWorkspace.status === 'pending' ? 'Analyzing...' : `Analyze selected media (${selectedMediaCount})`}
          </button>
          <p className="ai-assistant-media-limits">
            Up to {MEDIA_ANALYSIS_MAX_PHOTOS} photos per request. JPEG, PNG, and WEBP are supported. Generate Reel runs
            required safe analysis automatically. Video is accepted for metadata/manual review only.
          </p>
          {selectedPhotoCount > MEDIA_ANALYSIS_MAX_PHOTOS ? (
            <p className="ai-assistant-status-note">Generate Reel chooses up to {MEDIA_ANALYSIS_MAX_PHOTOS} photos deterministically. Reduce the selection only for manual analysis.</p>
          ) : null}
          {mediaAnalysisWorkspace.error ? (
            <p className="ai-assistant-analysis-error">
              <AlertTriangle size={16} aria-hidden="true" />
              {mediaAnalysisWorkspace.error}
            </p>
          ) : null}
          {mediaAnalysisWorkspace.result ? (
            <p className="ai-assistant-ai-status">
              Provider: {safeProviderLabel(mediaAnalysisWorkspace.result.provider)}
              {mediaAnalysisWorkspace.result.model ? ` / ${safeProviderLabel(mediaAnalysisWorkspace.result.model)}` : ''}.
              {mediaAnalysisWorkspace.result.warnings.length ? ` ${mediaAnalysisWorkspace.result.warnings.map((warning) => warning.message).join(' ')}` : ''}
            </p>
          ) : null}
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
              <article className="ai-assistant-media-card" data-attachment-id={item.id} key={item.id}>
                {item.kind === 'photo' && attachmentUrl(attachmentById.get(item.id) ?? item) ? (
                  <img src={attachmentUrl(attachmentById.get(item.id) ?? item)} alt={item.name} />
                ) : (
                  <div className="ai-assistant-media-placeholder">{/^video\//i.test(item.mimeType) ? 'Video' : 'Media'}</div>
                )}
                <div className="ai-assistant-media-identity">
                  <strong>{item.name || 'Approved media'}</strong>
                  <span>ID {shortAttachmentId(item.id)}</span>
                </div>
                <label className="ai-assistant-checkbox">
                  <input
                    type="checkbox"
                    aria-label={`Select ${item.name || 'media'} (${item.id}) for AI`}
                    checked={item.selected}
                    onChange={(event) => updateMediaItem(item.id, { selected: event.target.checked })}
                  />
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

          {analysisResultAttachments.length ? (
            <section className="ai-assistant-panel ai-assistant-media-analysis" aria-label="Media analysis review">
              <div className="ai-assistant-panel-heading">
                <h2>Media Findings Review</h2>
                <AlertTriangle size={18} aria-hidden="true" />
              </div>
              <div className="ai-assistant-analysis-results">
                {analysisResultAttachments.map((result) => (
                  <MediaAnalysisResultCard
                    key={result.id}
                    result={result}
                    attachment={attachmentById.get(result.id)}
                    approval={mediaAnalysisWorkspace.approvals[result.id] ?? 'pending'}
                    onApproval={(approval) => updateMediaApproval(result.id, approval)}
                  />
                ))}
              </div>
            </section>
          ) : null}

          {!unsupportedStatus ? (
            <section className="ai-reel-workspace" aria-label="AI Reel">
              <div className="ai-reel-heading">
                <div>
                  <span className="ai-reel-kicker"><Film size={16} aria-hidden="true" /> AI Reel</span>
                  <h2>Turn safe job media into a story</h2>
                </div>
                <span className={`ai-reel-status status-${reelWorkspace.status}`}>{reelStatusLabel(reelWorkspace.status)}</span>
              </div>

              <div className="ai-reel-media-selection" aria-label="Reel media selection">
                <div className="ai-reel-media-selection-heading">
                  <strong>Reel media selection</strong>
                  <span>Reel media: {currentReelMediaPlan.length} selected</span>
                </div>
                {currentReelMediaPlan.length ? (
                  <ol>
                    {currentReelMediaPlan.map((media) => (
                      <li key={media.attachmentId} data-attachment-id={media.attachmentId}>
                        <span>{media.position}.</span>
                        <span>
                          {assistantMediaById.get(media.attachmentId)?.name || 'Approved media'}
                          {' '}&middot;{' '}{shortAttachmentId(media.attachmentId)}
                        </span>
                      </li>
                    ))}
                  </ol>
                ) : <p>No Reel media selected</p>}
              </div>

              <div className="ai-reel-actions">
                <button
                  className="primary-button ai-reel-generate"
                  type="button"
                  onClick={generateReel}
                  disabled={['analyzing', 'creating_story'].includes(reelWorkspace.status)}
                >
                  <Sparkles size={18} aria-hidden="true" />
                  {['analyzing', 'creating_story'].includes(reelWorkspace.status) ? reelStatusLabel(reelWorkspace.status) : 'Generate Reel'}
                </button>
                <button className="secondary-button" type="button" onClick={() => setReelEditOpen((current) => !current)} aria-expanded={reelEditOpen}>
                  <SlidersHorizontal size={17} aria-hidden="true" />
                  Edit
                </button>
              </div>

              {reelWorkspace.status === 'reel_ready' && reelWorkspace.plan ? (
                <>
                <div className="ai-reel-result">
                  <div className="ai-reel-preview-column">
                    <ReelPreview plan={reelWorkspace.plan} mediaUrls={reelMediaUrls} />
                  </div>
                  <div className="ai-reel-story-column">
                    <div className="ai-reel-score-row">
                      <span>{formatReelAngle(reelWorkspace.plan.marketingAngle)}</span>
                      <strong>{reelWorkspace.plan.qualityScore}/100</strong>
                    </div>
                    <h3>{reelWorkspace.plan.hook.text}</h3>
                    <p>{reelWorkspace.plan.caption.text}</p>
                    {reelWorkspace.plan.voiceover.enabled ? (
                      <div className="ai-reel-voiceover"><strong>Voiceover</strong><span>{reelWorkspace.plan.voiceover.script}</span></div>
                    ) : null}
                    <button
                      className={reelApproved ? 'secondary-button ai-reel-approved' : 'primary-button'}
                      type="button"
                      onClick={approveReelForRendering}
                      disabled={reelApproved}
                    >
                      <CheckCircle2 size={18} aria-hidden="true" />
                      {reelApproved ? 'Reel approved' : 'Approve Reel'}
                    </button>
                    {reelWorkspace.creativePlanId || reelWorkspace.plan.creativePlanId ? (
                      <div className="ai-reel-render-actions">
                        <button className="primary-button" type="button" onClick={createMp4} disabled={!reelApproved || ['queued', 'rendering', 'completed', 'failed'].includes(activeReelRender.status)}>
                          <Video size={18} aria-hidden="true" />
                          {activeReelRender.status === 'queued' ? 'Queued' : activeReelRender.status === 'rendering' ? 'Rendering' : activeReelRender.status === 'completed' ? 'MP4 ready' : activeReelRender.status === 'failed' ? 'MP4 failed' : 'Create MP4'}
                        </button>
                        {activeReelRender.status === 'failed' || activeReelRender.status === 'not_configured' || activeReelRender.errorCode === 'REEL_RENDER_DISPATCH_FAILED'
                          ? <span className="ai-reel-approval-note">{renderErrorMessage(activeReelRender.errorCode)}</span>
                          : null}
                      </div>
                    ) : null}
                    {!reelApproved && reelWorkspace.approvalInvalidated ? <span className="ai-reel-approval-note">The preview changed and needs approval again.</span> : null}
                  </div>
                </div>
                {activeReelRender.status === 'completed' && activeReelRender.videoUrl ? (
                  <div className="ai-reel-render-result">
                    <video controls preload="metadata" poster={activeReelRender.coverUrl} src={activeReelRender.videoUrl} />
                    <div className="ai-reel-render-actions">
                      <a className="primary-button" href={activeReelRender.videoUrl} download><Download size={18} aria-hidden="true" />Download MP4</a>
                      <button className="secondary-button" type="button" onClick={refreshReelArtifacts}>Refresh link</button>
                    </div>
                  </div>
                ) : null}
                </>
              ) : null}

              {reelWorkspace.status === 'needs_more_media' && reelWorkspace.plan ? (
                <div className="ai-reel-decision-state">
                  <Image size={24} aria-hidden="true" />
                  <div><h3>A stronger Reel needs a few more shots</h3><ul>{reelWorkspace.plan.missingShots.map((shot) => <li key={shot}>{shot}</li>)}</ul></div>
                </div>
              ) : null}
              {reelWorkspace.status === 'skip' && reelWorkspace.plan ? (
                <div className="ai-reel-decision-state">
                  <Film size={24} aria-hidden="true" />
                  <div><h3>Not every job needs a Reel</h3><p>{reelWorkspace.plan.qualityReasons[0]}</p></div>
                </div>
              ) : null}
              {reelWorkspace.status === 'privacy_review_required' ? (
                <div className="ai-reel-decision-state error">
                  <Lock size={24} aria-hidden="true" />
                  <div><h3>Privacy review required</h3><p>{reelWorkspace.error}</p></div>
                </div>
              ) : null}
              {reelWorkspace.status === 'failed' ? (
                <div className="ai-reel-decision-state error"><AlertTriangle size={24} aria-hidden="true" /><div><h3>Reel generation failed</h3><p>{reelWorkspace.error}</p></div></div>
              ) : null}
            </section>
          ) : null}

          {reelEditOpen && !unsupportedStatus ? (
            mediaAnalysisWorkspace.result?.jobId === selectedJob?.id ? (
              <MediaPlanningWorkspace
                state={mediaPlanningState}
                media={assistantContext.publicSafe.media}
                privateValues={assistantContext.privateValues}
                onChange={setMediaPlanningState}
              />
            ) : (
              <div className="ai-reel-decision-state">
                <SlidersHorizontal size={24} aria-hidden="true" />
                <div>
                  <h3>Analyze media to edit the advanced media plan</h3>
                  <button className="secondary-button" type="button" onClick={analyzeMedia} disabled={mediaAnalysisWorkspace.status === 'pending'}>
                    Analyze media
                  </button>
                </div>
              </div>
            )
          ) : null}

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

          <section className="ai-assistant-panel ai-assistant-generation-settings">
            <div className="ai-assistant-panel-heading">
              <h2>AI Generation</h2>
              <Bot size={18} aria-hidden="true" />
            </div>
            {companyVoiceSummary.enabled ? <span className="ai-assistant-company-voice">Company voice enabled</span> : null}
            <label>
              Channel
              <select
                value={activeGenerationChannel}
                onChange={(event) => setActiveGenerationChannel(event.target.value as AssistantChannel)}
              >
                {ASSISTANT_CHANNELS.map((channel) => <option key={channel} value={channel}>{channel}</option>)}
              </select>
            </label>
            <label>
              Tone
              <select
                value={generationPreferencesByChannel[activeGenerationChannel].tone}
                onChange={(event) => updateActiveGenerationPreference({ tone: event.target.value as AssistantTone })}
              >
                {assistantTones.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </label>
            <label>
              Locale
              <input
                value={generationPreferencesByChannel[activeGenerationChannel].locale}
                onChange={(event) => updateActiveGenerationPreference({ locale: event.target.value })}
              />
            </label>
            <button className="secondary-button compact" type="button" onClick={resetGenerationDefaults}>
              <RotateCcw size={16} aria-hidden="true" />
              Reset defaults
            </button>
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
                    <button
                      className="secondary-button compact"
                      type="button"
                      onClick={() => generateChannelWithAi(draft.channel)}
                      disabled={Boolean(aiPendingChannel)}
                    >
                      {aiPendingChannel === draft.channel ? 'Generating...' : 'Generate with AI'}
                    </button>
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
                {aiStatusByChannel[draft.channel] ? <p className="ai-assistant-ai-status">{aiStatusByChannel[draft.channel]}</p> : null}
                {draft.channel === 'Facebook' && selectedJob ? (
                  <FacebookPublishPanel
                    key={`${companyId}:${selectedJob.id}`}
                    companyId={companyId}
                    jobId={selectedJob.id}
                    jobStatus={selectedJob.status}
                    message={draftWorkspace.drafts[draft.channel] ?? draft.body}
                    selectedMediaCount={selectedMediaCount}
                    photoCatalog={facebookPhotoCatalog}
                    refreshToken={facebookStatusRefreshToken}
                    privacyStatus="Server privacy validation will run again before publishing."
                  />
                ) : null}
              </article>
            ))}
          </section>
        </>
      ) : null}

      <p className="ai-assistant-phase-note">
        Drafts stay grounded in selected job data. Media analysis uses the secure server function only; no provider keys,
        private media links, OAuth, provider tokens, or direct database writes run in the browser.
      </p>
    </section>
  );
}

type MediaAnalysisResultCardProps = {
  result: MediaAnalysisAttachmentResult;
  attachment?: { name: string; dataUrl?: string; mimeType: string };
  approval: MediaReviewApprovalState;
  onApproval: (approval: MediaReviewApprovalState) => void;
};

function MediaAnalysisResultCard({ result, attachment, approval, onApproval }: MediaAnalysisResultCardProps) {
  const contentFindings = result.findings.filter((finding) => !isPrivacyFinding(finding.category));
  const privacyFindings = result.findings.filter((finding) => isPrivacyFinding(finding.category));
  const statusMessage = mediaStatusMessage(result.status, result.visualAnalysisPerformed);
  const previewUrl = attachment ? attachmentUrl(attachment) : '';

  return (
    <article className="ai-assistant-analysis-card">
      {result.kind === 'photo' && previewUrl ? (
        <img src={previewUrl} alt={attachment?.name ?? 'Selected media'} />
      ) : (
        <div className="ai-assistant-media-placeholder">{result.kind === 'video' ? 'Video' : 'Media'}</div>
      )}
      <div className="ai-assistant-analysis-card-body">
        <div className="ai-assistant-analysis-meta">
          <span>{result.kind}</span>
          <span>{mediaStatusLabel(result.status)}</span>
          <span>Manual review required</span>
        </div>
        {statusMessage ? <p className="ai-assistant-analysis-note">{statusMessage}</p> : null}
        <FindingGroup title="Content suggestions" findings={contentFindings} />
        <FindingGroup title="Privacy review" findings={privacyFindings} privacy />
        <div className="ai-assistant-approval-controls">
          <span>Review state: {approvalLabel(approval)}</span>
          <button className="secondary-button compact" type="button" onClick={() => onApproval('approved')}>Approve for use</button>
          <button className="secondary-button compact" type="button" onClick={() => onApproval('excluded')}>Exclude</button>
          {privacyFindings.length ? (
            <button className="secondary-button compact" type="button" onClick={() => onApproval('false_positive')}>Mark false positive</button>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function FindingGroup({ title, findings, privacy = false }: { title: string; findings: MediaAnalysisFinding[]; privacy?: boolean }) {
  if (!findings.length) return null;
  return (
    <div className="ai-assistant-finding-group">
      <h3>{title}</h3>
      {findings.map((finding) => (
        <div className="ai-assistant-finding" key={finding.findingId}>
          <div>
            <strong>{privacy ? 'Possible privacy concern' : 'AI suggestion'}</strong>
            <span>{formatCategory(finding.category)} · {Math.round(finding.confidence * 100)}% · Not verified</span>
          </div>
          <p>{finding.explanation}</p>
          {privacy ? <span className={`ai-assistant-risk ${finding.riskLevel}`}>{privacyRiskPriority(finding.category) || 'Review before use'}</span> : null}
        </div>
      ))}
    </div>
  );
}

function formatCategory(value: string) {
  return value.replace(/_/g, ' ');
}

function approvalLabel(value: MediaReviewApprovalState) {
  if (value === 'false_positive') return 'False positive';
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function safeProviderLabel(value: string) {
  return value.replace(/[^A-Za-z0-9_. -]/g, '').slice(0, 80);
}

function shortAttachmentId(value: string) {
  return value.length > 12 ? `${value.slice(0, 8)}\u2026${value.slice(-4)}` : value;
}

function contentResultToDraftText(result: ContentGenerationResult) {
  return [
    result.content.headline,
    result.content.body,
    result.content.callToAction ? `CTA: ${result.content.callToAction}` : '',
    result.content.hashtags.length ? result.content.hashtags.join(' ') : '',
  ].filter(Boolean).join('\n');
}

function unresolvedPrivacyAttachmentCount(
  result: MediaAnalysisResult | undefined,
  attachmentIds: string[],
  approvals: Record<string, MediaReviewApprovalState>,
) {
  const selected = new Set(attachmentIds);
  return result?.attachments.filter((attachment) => (
    selected.has(attachment.id)
      && approvals[attachment.id] !== 'false_positive'
      && attachment.findings.some((finding) => isPrivacyFinding(finding.category))
  )).length ?? 0;
}

function formatReelAngle(value: string) {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase());
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
