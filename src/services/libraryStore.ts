import type { LibraryCategory, LibraryDocument, LibraryDraft, LibraryFormat } from '../appTypes';
import { downloadSupabaseStorageFile, sqlEq, supabaseRequest, uploadSupabaseStorageFile } from './supabaseRest';

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
  uploaded_by: string | null;
  summary: string | null;
  file_name: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  storage_bucket: string | null;
  storage_path: string | null;
  created_at: string;
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

function rowToDocument(row: LibraryDocumentRow): LibraryDocument {
  return {
    id: row.id,
    title: row.title,
    category: row.category,
    system: row.system,
    manufacturer: row.manufacturer,
    model: row.model,
    format: row.format,
    tags: row.tags ?? [],
    uploadedAt: formatLibraryDate(row.created_at),
    fileSize: formatFileSize(row.size_bytes),
    uploadedBy: row.uploaded_by || 'Company admin',
    summary: row.summary || (row.file_name ? `Uploaded file: ${row.file_name}` : 'Reference document.'),
    fileName: row.file_name ?? undefined,
    mimeType: row.mime_type ?? undefined,
    sizeBytes: row.size_bytes ?? undefined,
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

export async function uploadLibraryDocument(companyId: string, draft: LibraryDraft, uploadedBy = 'Company admin') {
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
      uploaded_by: uploadedBy,
      summary: `Uploaded file: ${file.name}`,
      file_name: file.name,
      mime_type: file.type || 'application/octet-stream',
      size_bytes: file.size,
      storage_bucket: LIBRARY_BUCKET,
      storage_path: storagePath,
    },
  });

  return rowToDocument(rows[0]);
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
