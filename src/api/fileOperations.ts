import type { Transaction, TransactionLog } from '../models/transaction';
import { TransactionLogSchema, TransactionReadSchema } from '../models/schemas';
import { graphFetch, GraphError } from './graphClient';
import { getDriveItemUrl, getTransactionsPath } from './paths';

/**
 * Top-level shape stored on disk. `transactions` is `unknown[]` at this layer
 * to tolerate entries written by future bundles whose shape we don't recognize.
 */
export interface TransactionLogRaw {
  /**
   * Set to 2 by current writers; older logs may omit this field. Typed as
   * `number` (not `2`) so a future v3 file round-trips through this interface
   * without a cast — readers tolerate any version, writers stamp 2 explicitly.
   */
  schemaVersion?: number;
  /** Raw round-trip array — preserve byte-for-byte across reads/writes so we never drop unknown entries. */
  transactions: unknown[];
}

export interface FileReadResult {
  /** Raw log shape for write-back. Append new transactions to data.transactions to preserve unknown entries. */
  data: TransactionLogRaw;
  /** safeParse-passing entries only — pass to derivers and validators. */
  known: Transaction[];
  eTag: string;
}

const GRAPH_SIMPLE_PUT_LIMIT = 4_000_000; // bytes — Graph caps simple PUT at 4MB per docs.

/**
 * Thrown when the encoded log body would exceed Graph's simple-PUT cap.
 * Bumping past 4 MB requires a new write strategy (sharding or a properly
 * eTag-guarded session) — until that lands, we fail loud rather than write
 * unsafely. Realistically years away for this app's transaction volume.
 */
export class LogTooLargeError extends Error {
  byteLength: number;
  constructor(byteLength: number) {
    super(
      `transactions.json (${byteLength} bytes) exceeds the ${GRAPH_SIMPLE_PUT_LIMIT}-byte ` +
      `Graph simple-PUT cap. Multi-chunk upload sessions cannot be eTag-guarded for ` +
      `concurrent appenders, so this write is refused. Contact the app owner — log ` +
      `sharding is the next step.`,
    );
    this.name = 'LogTooLargeError';
    this.byteLength = byteLength;
  }
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

  // Step 3: Validate the top-level envelope only. Per-entry parsing is
  // tolerant: a single bad/unknown entry does not poison the whole log.
  const parsed = TransactionLogSchema.parse(raw);

  const known: Transaction[] = [];
  for (const entry of parsed.transactions) {
    const result = TransactionReadSchema.safeParse(entry);
    if (result.success) {
      known.push(result.data as Transaction);
    } else {
      console.warn('[fileOperations] Skipping unrecognized transaction entry:', result.error.message);
    }
  }

  return {
    data: { schemaVersion: parsed.schemaVersion, transactions: parsed.transactions },
    known,
    eTag,
  };
}

/**
 * Write transactions.json back to SharePoint with ETag for optimistic
 * concurrency. Returns the new eTag on success. Throws ConflictError on 412.
 *
 * Throws LogTooLargeError if the encoded body exceeds the Graph simple-PUT
 * cap. The earlier upload-session fallback was removed because Graph's
 * createUploadSession only checks If-Match at session creation; the chunk
 * PUTs that actually commit content carry no eTag guard, so a concurrent
 * appender during the upload window would be silently overwritten.
 */
export async function writeTransactionLog(
  data: TransactionLog | TransactionLogRaw,
  eTag: string,
): Promise<string> {
  // Encode once and check the BYTE length: Graph caps simple PUT in bytes,
  // but JSON.stringify returns a JS string whose .length is in UTF-16 code
  // units — supplier names, notes, etc. with non-ASCII characters produce
  // more bytes than chars, so a byte-blind threshold check would route an
  // over-cap body through the simple-PUT path and 413.
  const bodyBytes = new TextEncoder().encode(JSON.stringify(data, null, 2));
  if (bodyBytes.byteLength > GRAPH_SIMPLE_PUT_LIMIT) {
    throw new LogTooLargeError(bodyBytes.byteLength);
  }

  const url = getDriveItemUrl(getTransactionsPath()).replace(/:$/, ':/content');
  const response = await graphFetch(url, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'If-Match': eTag,
    },
    body: new Blob([bodyBytes as BlobPart], { type: 'application/json' }),
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

/**
 * Create a folder under `parentChildrenUrl`. Idempotent: 409 (folder already
 * exists) and 412 (concurrent create) are swallowed. Other errors propagate.
 */
export async function createFolder(parentChildrenUrl: string, name: string): Promise<void> {
  try {
    await graphFetch(parentChildrenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        folder: {},
        '@microsoft.graph.conflictBehavior': 'fail',
      }),
    });
  } catch (err) {
    if (err instanceof GraphError && (err.status === 409 || err.status === 412)) {
      return;
    }
    throw err;
  }
}
