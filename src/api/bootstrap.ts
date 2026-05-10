import { graphFetch, GraphError, ConfigurationError } from './graphClient';
import { getDriveItemUrl, getBasePath, getImagesFolderPath, getOrdersFolderPath, getTransactionsPath, getDriveChildrenUrl } from './paths';
import { checkFileExists, createFolder, readTransactionLog, type FileReadResult } from './fileOperations';
import type { TransactionLog } from '../models/transaction';

/**
 * One-time initialization of the SharePoint data store. Ensures folder
 * structure exists and transactions.json is valid; returns the parsed log
 * so callers can avoid a second read round-trip.
 */
export async function initializeDataStore(): Promise<FileReadResult> {
  try {
    await graphFetch(getDriveItemUrl(getBasePath()));
  } catch (err) {
    if (err instanceof GraphError && err.status === 404) {
      throw new ConfigurationError(
        `SharePoint folder not found at "${getBasePath()}" — check VITE_SHAREPOINT_FOLDER_PATH`,
      );
    }
    throw err;
  }

  const [imagesExist, ordersExist, txExists] = await Promise.all([
    checkFileExists(getImagesFolderPath()),
    checkFileExists(getOrdersFolderPath()),
    checkFileExists(getTransactionsPath()),
  ]);

  const baseChildrenUrl = getDriveChildrenUrl();
  await Promise.all([
    imagesExist ? Promise.resolve() : createFolder(baseChildrenUrl, 'images'),
    ordersExist ? Promise.resolve() : createFolder(baseChildrenUrl, 'orders'),
  ]);

  if (!txExists) {
    const emptyLog: TransactionLog = { transactions: [] };
    const url = getDriveItemUrl(getTransactionsPath()).replace(/:$/, ':/content');
    try {
      // If-None-Match: * makes this a create-only PUT. The existence check
      // above is a best-effort optimization; this header is the actual race
      // guard — a concurrent session that created the file between the check
      // and this PUT will return 412 and we fall through to read what they
      // wrote, never replacing it with an empty log.
      await graphFetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'If-None-Match': '*' },
        body: JSON.stringify(emptyLog, null, 2),
      });
    } catch (err) {
      // 409/412 = another browser created it first; fall through to read.
      if (!(err instanceof GraphError && (err.status === 409 || err.status === 412))) {
        throw err;
      }
    }
  }

  return readTransactionLog();
}
