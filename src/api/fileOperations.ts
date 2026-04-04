import type { TransactionLog } from '../models/transaction';
import { TransactionLogSchema } from '../models/schemas';
import { graphFetch, GraphError } from './graphClient';
import { getDriveItemUrl, getTransactionsPath } from './paths';

export interface FileReadResult {
  data: TransactionLog;
  eTag: string;
}

/**
 * Read transactions.json from SharePoint using the two-step approach:
 * 1. GET metadata → extract eTag and @microsoft.graph.downloadUrl
 * 2. Fetch content from the download URL (pre-authenticated, no 302 issues)
 */
export async function readTransactionLog(): Promise<FileReadResult> {
  const metadataUrl = getDriveItemUrl(getTransactionsPath());

  // Step 1: Get metadata (eTag + downloadUrl)
  const metaResponse = await graphFetch(metadataUrl);
  const meta = await metaResponse.json();
  const eTag = meta.eTag as string;
  const downloadUrl = meta['@microsoft.graph.downloadUrl'] as string;

  if (!downloadUrl) {
    throw new Error('No downloadUrl in Graph metadata response');
  }

  // Step 2: Fetch actual file content from downloadUrl (no auth needed)
  const contentResponse = await fetch(downloadUrl);
  if (!contentResponse.ok) {
    throw new Error(`Failed to download transactions.json: ${contentResponse.status}`);
  }

  const raw = await contentResponse.json();

  // Step 3: Validate with Zod
  const parsed = TransactionLogSchema.parse(raw);

  return { data: parsed as TransactionLog, eTag };
}

/**
 * Write transactions.json back to SharePoint with ETag for optimistic concurrency.
 * Returns the new eTag on success. Throws ConflictError on 412.
 */
export async function writeTransactionLog(data: TransactionLog, eTag: string): Promise<string> {
  const url = getDriveItemUrl(getTransactionsPath()).replace(/:$/, ':/content');

  const response = await graphFetch(url, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'If-Match': eTag,
    },
    body: JSON.stringify(data, null, 2),
  });

  const result = await response.json();
  return result.eTag as string;
}

/**
 * Check if a file/folder exists at the given SharePoint path.
 */
export async function checkFileExists(path: string): Promise<boolean> {
  try {
    await graphFetch(getDriveItemUrl(path));
    return true;
  } catch (err) {
    if (err instanceof GraphError && err.status === 404) {
      return false;
    }
    throw err;
  }
}
