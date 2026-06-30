import { deleteSupabaseStorageFiles } from './supabaseRest';

export async function deleteJobFile(companyId: string, jobId: string, attachmentId: string, storageBucket?: string, storagePath?: string) {
  if (!companyId || !jobId || !attachmentId) {
    throw new Error('Company, job, and attachment are required.');
  }

  if (storageBucket && storagePath) {
    await deleteSupabaseStorageFiles(storageBucket, [storagePath]);
  }
}
