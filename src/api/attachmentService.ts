import { v4 as uuidv4 } from 'uuid';
import { graphFetch, GraphError } from './graphClient';
import { getDriveItemUrl, getOrderFilePath, getOrderFolderPath, getOrdersFolderPath, getDriveChildrenUrl } from './paths';
import { createFolder } from './fileOperations';
import { sanitizeFilename } from './filenames';
import type { OrderAttachment } from '../models/order';
import { getCurrentUserEmail } from '../auth/currentUser';

export const ALLOWED_EXTENSIONS = ['pdf', 'jpg', 'jpeg', 'png', 'heic', 'docx', 'xlsx'] as const;
export const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/heic',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);
// 4 MB matches the Graph simple-PUT cap that uploadOrderAttachment uses.
// Larger files require a createUploadSession + chunked upload (see the
// fileOperations.ts upload-session pattern) — not yet implemented for
// attachments, so reject before we'd hit a confusing 413 mid-save.
export const MAX_FILE_SIZE = 4 * 1024 * 1024;

/** Pre-built `accept` attribute for `<input type="file">`. */
export const ATTACHMENT_ACCEPT_ATTRIBUTE = ALLOWED_EXTENSIONS.map((e) => `.${e}`).join(',');

export class AttachmentValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AttachmentValidationError';
  }
}

/** Validate a file before upload. Throws AttachmentValidationError on failure. */
export function validateAttachmentFile(file: File): void {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if (!ALLOWED_EXTENSIONS.includes(ext as typeof ALLOWED_EXTENSIONS[number])) {
    throw new AttachmentValidationError(`File type ".${ext}" not allowed. Permitted: ${ALLOWED_EXTENSIONS.join(', ')}`);
  }
  if (file.type && !ALLOWED_MIME_TYPES.has(file.type)) {
    throw new AttachmentValidationError(`MIME type "${file.type}" not allowed`);
  }
  if (file.size > MAX_FILE_SIZE) {
    throw new AttachmentValidationError(`File "${file.name}" exceeds the ${MAX_FILE_SIZE / 1024 / 1024} MB limit`);
  }
}

/** Merge two file lists, deduplicating by `name + size`. */
export function mergeFilesDedup(prev: File[], incoming: File[]): File[] {
  const seen = new Set(prev.map((f) => `${f.name}::${f.size}`));
  const fresh = incoming.filter((f) => !seen.has(`${f.name}::${f.size}`));
  return [...prev, ...fresh];
}

export async function ensureOrderFolder(orderId: string): Promise<void> {
  await createFolder(getDriveChildrenUrl(getOrdersFolderPath()), orderId);
}

export async function uploadOrderAttachment(
  orderId: string,
  file: File,
  stage: 'placed' | 'received',
  signal?: AbortSignal,
): Promise<OrderAttachment> {
  validateAttachmentFile(file);

  const ext = file.name.split('.').pop() || '';
  const baseName = file.name.replace(/\.[^.]+$/, '');
  const filename = `${uuidv4()}-${sanitizeFilename(baseName)}.${ext}`;

  const url = getDriveItemUrl(getOrderFilePath(orderId, filename)).replace(/:$/, ':/content');

  await graphFetch(url, {
    method: 'PUT',
    headers: {
      'Content-Type': file.type || 'application/octet-stream',
    },
    body: file,
    signal,
  });

  return {
    id: uuidv4(),
    stage,
    filename,
    originalFilename: file.name,
    contentType: file.type || 'application/octet-stream',
    sizeBytes: file.size,
    uploadedAt: new Date().toISOString(),
    uploadedBy: getCurrentUserEmail(),
  };
}

/** Best-effort delete. Swallows 404s so duplicate cleanup paths don't surface noise. */
export async function deleteOrderAttachment(orderId: string, filename: string): Promise<void> {
  const url = getDriveItemUrl(getOrderFilePath(orderId, filename));
  try {
    await graphFetch(url, { method: 'DELETE' });
  } catch (err) {
    if (err instanceof GraphError && err.status === 404) {
      return;
    }
    throw err;
  }
}

/** Pre-authenticated download URL for an order attachment. */
export async function getOrderAttachmentUrl(orderId: string, filename: string): Promise<string> {
  const metadataUrl = getDriveItemUrl(getOrderFilePath(orderId, filename));
  const response = await graphFetch(metadataUrl);
  const meta = await response.json();
  return meta['@microsoft.graph.downloadUrl'] as string;
}

/** Used by the maintenance script to delete an entire order subfolder. */
export async function deleteOrderFolder(orderId: string): Promise<void> {
  const url = getDriveItemUrl(getOrderFolderPath(orderId));
  try {
    await graphFetch(url, { method: 'DELETE' });
  } catch (err) {
    if (err instanceof GraphError && err.status === 404) {
      return;
    }
    throw err;
  }
}
