import { supabaseFunction } from './supabaseRest';
import type { AuthSession } from '../appTypes';

export type PreviewQaWorkspaceAction = 'create' | 'disable' | 'delete';

export type PreviewQaWorkspaceResult = {
  ok: true;
  action: PreviewQaWorkspaceAction;
  companyId: string;
  companyName: string;
  email?: string;
  loginReady?: boolean;
  remainingRows?: number;
};

export function isPreviewQaToolsEnabled(env: { VITE_PREVIEW_QA_TOOLS_ENABLED?: string | boolean | undefined }) {
  return env.VITE_PREVIEW_QA_TOOLS_ENABLED === true || env.VITE_PREVIEW_QA_TOOLS_ENABLED === 'true';
}

export function shouldShowPreviewQaTools(input: {
  authSession: AuthSession | null;
  currentOwnerRole: string;
  env: { VITE_PREVIEW_QA_TOOLS_ENABLED?: string | boolean | undefined };
}) {
  return input.authSession?.kind === 'owner'
    && input.currentOwnerRole === 'owner'
    && isPreviewQaToolsEnabled(input.env);
}

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
