#!/usr/bin/env node
/**
 * prune-order-attachments — maintenance script for SharePoint /InventoryApp/orders.
 *
 * Reads transactions.json via Graph, derives the set of valid orderIds via
 * deriveOrders, lists all subfolders under /InventoryApp/orders/, and DELETEs
 * any folder whose orderId is not in the valid set.
 *
 * Defaults to a dry-run report. Pass --apply to actually delete.
 *
 * Auth: MSAL-Node device-code flow under the maintainer's Microsoft 365 account.
 *
 * Usage:
 *   npm run prune:dry        # dry run, lists what would be deleted
 *   npm run prune:apply      # actually deletes orphan folders
 *
 * TOCTOU safety: only deletes folders whose lastModifiedDateTime is older
 * than 30 minutes — well past any realistic save-flow window.
 */

import { PublicClientApplication, LogLevel } from '@azure/msal-node';
import { deriveOrders } from '../src/utils/deriveState';
import { TransactionReadSchema } from '../src/models/schemas';
import type { Transaction } from '../src/models/transaction';

const TENANT_ID = process.env.MSAL_TENANT_ID || '';
const CLIENT_ID = process.env.MSAL_CLIENT_ID || '';
const DRIVE_ID = process.env.SHAREPOINT_DRIVE_ID || '';
const BASE_PATH = process.env.SHAREPOINT_FOLDER_PATH || '/InventoryApp';
const SCOPES = ['Sites.ReadWrite.All'];
const MIN_AGE_MIN = 30;

if (!TENANT_ID || !CLIENT_ID || !DRIVE_ID) {
  console.error('Missing env: MSAL_TENANT_ID, MSAL_CLIENT_ID, SHAREPOINT_DRIVE_ID required');
  process.exit(1);
}

const apply = process.argv.includes('--apply');

async function main() {
  const pca = new PublicClientApplication({
    auth: {
      clientId: CLIENT_ID,
      authority: `https://login.microsoftonline.com/${TENANT_ID}`,
    },
    system: {
      loggerOptions: {
        loggerCallback: () => undefined,
        piiLoggingEnabled: false,
        logLevel: LogLevel.Warning,
      },
    },
  });

  console.log('Acquiring token via device code flow...');
  const result = await pca.acquireTokenByDeviceCode({
    scopes: SCOPES,
    deviceCodeCallback: (info) => console.log(info.message),
  });
  if (!result?.accessToken) {
    console.error('Token acquisition failed');
    process.exit(1);
  }
  const token = result.accessToken;

  // Read transactions.json
  console.log('Reading transactions.json...');
  const { known, total } = await readKnownTransactions(token);
  if (known.length !== total) {
    console.error(
      `\nABORT: ${total - known.length} of ${total} transaction entries failed to parse. ` +
      `Pruning is unsafe — a real order whose record is unparseable would be treated as ` +
      `orphaned and its attachments DELETED. Resolve the parse failures before running prune.`,
    );
    process.exit(2);
  }
  const validOrders = new Set(deriveOrders(known).map((o) => o.id));
  console.log(`Found ${validOrders.size} valid orders (all ${total} log entries parsed cleanly).`);

  // List orders/ folder children
  console.log(`Listing /orders subfolders...`);
  const childrenUrl = `/drives/${DRIVE_ID}/root:${BASE_PATH}/orders:/children`;
  const children = await graph(childrenUrl, token);
  const folders = (children.value || []) as Array<{
    id: string; name: string; folder?: object; lastModifiedDateTime?: string;
  }>;
  const cutoff = Date.now() - MIN_AGE_MIN * 60 * 1000;

  const toDelete: string[] = [];
  let skippedYoung = 0;
  for (const f of folders) {
    if (!f.folder) continue;
    if (validOrders.has(f.name)) continue;
    if (f.lastModifiedDateTime && Date.parse(f.lastModifiedDateTime) > cutoff) {
      skippedYoung++;
      continue;
    }
    toDelete.push(f.name);
  }

  console.log(`\nFound ${folders.length} subfolders.`);
  console.log(`Valid: ${folders.length - toDelete.length - skippedYoung}`);
  console.log(`Orphan, eligible: ${toDelete.length}`);
  console.log(`Skipped (younger than ${MIN_AGE_MIN} min): ${skippedYoung}`);

  if (toDelete.length === 0) {
    console.log('\nNothing to do.');
    return;
  }

  if (!apply) {
    console.log('\n[dry run] Folders that would be deleted:');
    for (const id of toDelete) console.log(`  ${id}`);
    console.log('\nRe-run with --apply to actually delete.');
    return;
  }

  console.log('\nApplying deletions...');
  for (const id of toDelete) {
    // Re-read just before each delete to handle concurrent writes — and
    // re-apply the strict-parse check so a corrupted/future entry written
    // mid-run can't make us delete a folder we'd otherwise spare.
    const recheck = await readKnownTransactions(token);
    if (recheck.known.length !== recheck.total) {
      console.error(
        `  ABORT (mid-run): ${recheck.total - recheck.known.length} entries became unparseable; ` +
        `stopping before any further deletions.`,
      );
      process.exit(2);
    }
    const recheckValid = new Set(deriveOrders(recheck.known).map((o) => o.id));
    if (recheckValid.has(id)) {
      console.log(`  SKIP ${id} (became valid mid-run)`);
      continue;
    }
    await graph(`/drives/${DRIVE_ID}/root:${BASE_PATH}/orders/${id}`, token, 'DELETE');
    console.log(`  DELETED ${id}`);
  }
  console.log('\nDone.');
}

async function readKnownTransactions(token: string): Promise<{ known: Transaction[]; total: number }> {
  const meta = await graph(`/drives/${DRIVE_ID}/root:${BASE_PATH}/transactions.json`, token);
  const downloadUrl = meta['@microsoft.graph.downloadUrl'] as string;
  const content = await fetch(downloadUrl).then((r) => r.json()) as { transactions: unknown[] };
  const known: Transaction[] = [];
  for (const entry of content.transactions) {
    const parsed = TransactionReadSchema.safeParse(entry);
    if (parsed.success) known.push(parsed.data as Transaction);
  }
  return { known, total: content.transactions.length };
}

async function graph(path: string, token: string, method: string = 'GET'): Promise<{ [key: string]: unknown; value?: unknown[]; '@microsoft.graph.downloadUrl'?: string }> {
  const url = `https://graph.microsoft.com/v1.0${path}`;
  const r = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok && r.status !== 204) {
    throw new Error(`Graph ${method} ${path} → ${r.status} ${r.statusText}`);
  }
  if (r.status === 204) return {};
  return r.json();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
