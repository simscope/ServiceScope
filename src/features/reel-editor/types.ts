export type Pose = { scale: number; x: number; y: number };
export type EditorScene = {
  id: string; attachmentId: string; role: string; frames: number;
  crop: { mode: string; scale: number; x: number; y: number };
  motion: { kind: string; intensity: number; start: Pose; end: Pose };
  transition: { kind: string; frames: number };
  text: { enabled: boolean; label: string; headline: string; subline: string; factRefs: string[]; x: number; y: number; width: number; fontSize: number; align: string; color: string; background: string; backplate: boolean; appear: number; disappear: number };
};
export type EditorDraft = {
  contract: string; jobId: string;
  brief: { problem: string; work: string; result: string; checks: string; prohibited: string; language: string; emphasis: string; mediaRefs: string[] };
  scenes: EditorScene[]; brand: { enabled: boolean; displayName: string; logo: boolean; cta: string; frames: number }; caption: string;
};
export type EditorMedia = { attachmentId: string; url: string; name: string; width: number; height: number; privacy: string; identity?: string; mimeType?: string };
export type EditorRow = { draft: EditorDraft; revision: number; brief_confirmation: { actorId: string; revision: number; confirmedAt: string } | null; approval: { creativePlanId: string; revision: string; draftRevision: number } | null; approvalApplicable?: boolean; approvalError?: string | null };
export type EditorBrand = { displayName: string; logoAvailable: boolean; allowedCtas: string[] };
export type EditorBackend = {
  load: () => Promise<{ row: EditorRow | null; media: Partial<EditorMedia>[]; brand: EditorBrand; render?: { status: string; videoUrl?: string; renderJobId?: string } }>;
  save: (draft: EditorDraft, revision: number, confirmBrief: boolean) => Promise<{ row: EditorRow }>;
  approve: (revision: number) => Promise<{ row: EditorRow }>;
  render: (approval: NonNullable<EditorRow['approval']>) => Promise<{ status: string; videoUrl?: string; renderJobId?: string }>;
};
