import { graphFetch, GraphError, ConfigurationError } from './graphClient';
import { getDriveItemUrl, getBasePath, getImagesFolderPath, getTransactionsPath, getDriveChildrenUrl } from './paths';
import { checkFileExists, readTransactionLog } from './fileOperations';
import type { TransactionLog } from '../models/transaction';

/**
 * One-time initialization of the SharePoint data store.
 * Ensures the folder structure exists and transactions.json is valid.
 *
 * 1. Verify SharePoint folder exists (fatal if not)
 * 2. Create images/ subfolder if missing
 * 3. Create transactions.json if missing (handle race with 409/412)
 * 4. Read and validate existing transactions.json
 */
export async function initializeDataStore(): Promise<void> {
  // 1. Verify base folder exists
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

  // 2. Ensure images/ subfolder exists
  const imagesExist = await checkFileExists(getImagesFolderPath());
  if (!imagesExist) {
    try {
      await graphFetch(getDriveChildrenUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'images',
          folder: {},
          '@microsoft.graph.conflictBehavior': 'fail',
        }),
      });
    } catch (err) {
      // 409 conflict = another browser created it first → fine
      if (err instanceof GraphError && (err.status === 409 || err.status === 412)) {
        // Race condition: folder already created by another session
      } else {
        throw err;
      }
    }
  }

  // 3. Ensure transactions.json exists
  const txExists = await checkFileExists(getTransactionsPath());
  if (!txExists) {
    const emptyLog: TransactionLog = { transactions: [] };
    const url = getDriveItemUrl(getTransactionsPath()).replace(/:$/, ':/content');
    try {
      await graphFetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(emptyLog, null, 2),
      });
    } catch (err) {
      // 409/412 conflict = another browser created it first → re-read instead of failing
      if (err instanceof GraphError && (err.status === 409 || err.status === 412)) {
        await readTransactionLog(); // validate the file the other browser created
        return;
      }
      throw err;
    }
  }

  // 4. Read and validate existing file
  await readTransactionLog();
}
