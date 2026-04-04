import { v4 as uuidv4 } from 'uuid';
import { graphFetch } from './graphClient';
import { getDriveItemUrl, getImageFilePath } from './paths';

/**
 * Sanitize a filename: strip path separators, collapse whitespace, lowercase.
 */
function sanitizeFilename(name: string): string {
  return name
    .replace(/[/\\:*?"<>|]/g, '')
    .replace(/\s+/g, '-')
    .toLowerCase();
}

/**
 * Upload an image to SharePoint /InventoryApp/images/{uuid}-{sanitized-name}
 * Returns the generated filename for use in transaction data.
 */
export async function uploadImage(file: File): Promise<string> {
  const ext = file.name.split('.').pop() || 'jpg';
  const baseName = file.name.replace(/\.[^.]+$/, '');
  const filename = `${uuidv4()}-${sanitizeFilename(baseName)}.${ext}`;

  const url = getDriveItemUrl(getImageFilePath(filename)).replace(/:$/, ':/content');

  await graphFetch(url, {
    method: 'PUT',
    headers: {
      'Content-Type': file.type || 'application/octet-stream',
    },
    body: file,
  });

  return filename;
}

/**
 * Get a pre-authenticated download URL for an image.
 * Uses the two-step metadata approach to get @microsoft.graph.downloadUrl.
 */
export async function getImageUrl(filename: string): Promise<string> {
  const metadataUrl = getDriveItemUrl(getImageFilePath(filename));
  const response = await graphFetch(metadataUrl);
  const meta = await response.json();
  return meta['@microsoft.graph.downloadUrl'] as string;
}
