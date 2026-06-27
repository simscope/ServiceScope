import type { LibraryCategory, LibraryDocument, LibraryDraft, LibraryFormat } from '../appTypes';
import { deleteSupabaseStorageFiles, downloadSupabaseStorageFile, sqlEq, supabaseRequest, uploadSupabaseStorageFile } from './supabaseRest';

const LIBRARY_BUCKET = 'library';

type LibraryDocumentRow = {
  id: string;
  company_id: string;
  title: string;
  category: LibraryCategory;
  system: string;
  manufacturer: string;
  model: string;
  format: LibraryFormat;
  tags: string[] | null;
  summary: string | null;
  storage_bucket: string | null;
  storage_path: string | null;
  external_url: string | null;
  file_size_bytes: number | null;
  uploaded_by_user_id: string | null;
  created_at: string;
  updated_at: string;
};

function safeFileName(value: string) {
  return (value.trim() || 'document').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'document';
}

function formatFileSize(sizeBytes?: number | null) {
  const size = Number(sizeBytes) || 0;
  if (!size) return 'No file';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function formatLibraryDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);
  return date.toISOString().slice(0, 10);
}

function detectFormat(fileName: string, mimeType = ''): LibraryFormat {
  const normalizedName = fileName.toLowerCase();
  const normalizedMime = mimeType.toLowerCase();
  if (normalizedMime.startsWith('image/') || /\.(png|jpe?g|webp|gif|heic|heif)$/i.test(normalizedName)) return 'Image';
  if (normalizedMime.startsWith('video/') || /\.(mp4|mov|webm)$/i.test(normalizedName)) return 'Video';
  return 'PDF';
}

function inferFileNameFromPath(storagePath?: string | null) {
  if (!storagePath) return undefined;
  const rawName = storagePath.split('/').pop() ?? '';
  return rawName.replace(/^[0-9a-f-]{36}-/i, '') || undefined;
}

function inferMimeTypeFromName(fileName = '') {
  const normalized = fileName.toLowerCase();
  if (normalized.endsWith('.pdf')) return 'application/pdf';
  if (normalized.endsWith('.png')) return 'image/png';
  if (normalized.endsWith('.jpg') || normalized.endsWith('.jpeg')) return 'image/jpeg';
  if (normalized.endsWith('.webp')) return 'image/webp';
  if (normalized.endsWith('.doc')) return 'application/msword';
  if (normalized.endsWith('.docx')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  return 'application/octet-stream';
}

function rowToDocument(row: LibraryDocumentRow): LibraryDocument {
  const fileName = inferFileNameFromPath(row.storage_path);
  return {
    id: row.id,
    title: row.title,
    category: row.category,
    system: row.system || 'General',
    manufacturer: row.manufacturer || 'Unknown',
    model: row.model || 'Any model',
    format: row.format,
    tags: row.tags ?? [],
    uploadedAt: formatLibraryDate(row.created_at),
    fileSize: formatFileSize(row.file_size_bytes),
    uploadedBy: row.uploaded_by_user_id ? 'Company user' : 'Company admin',
    summary: row.summary || (fileName ? `Uploaded file: ${fileName}` : 'Reference document.'),
    fileName,
    mimeType: inferMimeTypeFromName(fileName),
    sizeBytes: row.file_size_bytes ?? undefined,
    storageBucket: row.storage_bucket ?? undefined,
    storagePath: row.storage_path ?? undefined,
  };
}

export async function listLibraryDocuments(companyId: string) {
  const rows = await supabaseRequest<LibraryDocumentRow[]>(
    `library_documents?company_id=${sqlEq(companyId)}&select=*&order=created_at.desc`,
  );
  return rows.map(rowToDocument);
}

export async function uploadLibraryDocument(companyId: string, draft: LibraryDraft, _uploadedBy = 'Company admin') {
  if (!draft.title.trim()) throw new Error('Document title is required.');
  if (!draft.file) throw new Error('Choose a file before adding it to the library.');

  const id = crypto.randomUUID();
  const file = draft.file;
  const storagePath = `${companyId}/${id}-${safeFileName(file.name)}`;
  const format = detectFormat(file.name, file.type);
  const tags = draft.tags.split(',').map((tag) => tag.trim()).filter(Boolean);

  await uploadSupabaseStorageFile(LIBRARY_BUCKET, storagePath, file, file.type || 'application/octet-stream');

  const rows = await supabaseRequest<LibraryDocumentRow[]>('library_documents?select=*', {
    method: 'POST',
    select: true,
    body: {
      id,
      company_id: companyId,
      title: draft.title.trim(),
      category: draft.category,
      system: draft.system.trim() || 'General',
      manufacturer: draft.manufacturer.trim() || 'Unknown',
      model: draft.model.trim() || 'Any model',
      format,
      tags,
      summary: `Uploaded file: ${file.name}`,
      storage_bucket: LIBRARY_BUCKET,
      storage_path: storagePath,
      external_url: null,
      file_size_bytes: file.size,
    },
  });

  return rowToDocument(rows[0]);
}

export async function deleteLibraryDocument(companyId: string, document: LibraryDocument) {
  if (document.storageBucket && document.storagePath) {
    await deleteSupabaseStorageFiles(document.storageBucket, [document.storagePath]);
  }

  await supabaseRequest(
    `library_documents?company_id=${sqlEq(companyId)}&id=${sqlEq(document.id)}`,
    { method: 'DELETE' },
  );
}

export async function openLibraryDocument(document: LibraryDocument) {
  if (!document.storageBucket || !document.storagePath) {
    throw new Error('This document does not have a stored file yet.');
  }

  const blob = await downloadSupabaseStorageFile(document.storageBucket, document.storagePath);
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank', 'noopener,noreferrer');
  window.setTimeout(() => URL.revokeObjectURL(url), 60000);
}
