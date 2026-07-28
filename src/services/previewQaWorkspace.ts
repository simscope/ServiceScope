import { supabaseFunction } from './supabaseRest';
export type PreviewQaWorkspaceAction = 'create' | 'disable' | 'enable' | 'delete';

export type PreviewQaWorkspaceResult = {
  ok: true;
  action: PreviewQaWorkspaceAction;
  companyId: string;
  companyName: string;
  email?: string;
  loginReady?: boolean;
  remainingRows?: number;
  remainingStorageObjects?: number;
  remainingAuthUsers?: number;
};

export async function managePreviewQaWorkspace(input: {
  action: PreviewQaWorkspaceAction;
  email?: string;
  temporaryPassword?: string;
}) {
  return supabaseFunction<PreviewQaWorkspaceResult>('preview-qa-workspace', {
    action: input.action,
    email: input.email,
    temporaryPassword: input.temporaryPassword,
  }, { timeoutMs: 30000 });
}
