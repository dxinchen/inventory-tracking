import { v4 as uuidv4 } from 'uuid';
import type {
  Transaction,
  TransactionInput,
  ItemCreateData,
  ItemUpdateData,
  StockData,
  OrderCreateData,
  OrderReceiveData,
} from '../models/transaction';
import type { InventoryItem } from '../models/inventory';
import type { Order } from '../models/order';
import { readTransactionLog, writeTransactionLog, type TransactionLogRaw } from './fileOperations';
import {
  deriveInventoryMap,
  deriveOrdersMap,
  applyToInventoryMap,
  applyToOrdersMap,
} from '../utils/deriveState';
import {
  validateStockIn,
  validateStockOut,
  validateItemCreate,
  validateItemUpdate,
  ItemNotFoundError,
  ItemReferencedByOrderError,
  ReceiveCoverageError,
  EmptyReceiveError,
  ReceiveStockInBindingError,
  PoNumberInUseError,
  OrderNotFoundError,
  OrderNotPlacedError,
} from '../utils/validation';
import { TransactionWriteSchema } from '../models/schemas';
import { ConflictError } from './graphClient';
import { getCurrentUserEmail } from '../auth/currentUser';

const MAX_RETRIES = 6;
const BASE_DELAY_MS = 50;

/** Result returned by appendTransaction(s) — replaces both raw and derived state in the context. */
export interface WriteResult {
  /** RAW round-trip array including any unknown stale-bundle entries — persist this as the next write-back input. */
  transactions: unknown[];
  /** safeParse-passing entries only — for in-memory iteration. */
  known: Transaction[];
  /** Post-commit derived inventory. */
  items: InventoryItem[];
  /** Post-commit derived orders. */
  orders: Order[];
}

export class StubSkuCollisionError extends Error {
  constructor(sku: string) {
    super(`Generated stub SKU "${sku}" already exists. Try saving again.`);
    this.name = 'StubSkuCollisionError';
  }
}

export class DuplicateInputIdError extends Error {
  constructor() {
    super('Two transactions in the same batch share an id (programmer error)');
    this.name = 'DuplicateInputIdError';
  }
}

export class DuplicateOrderIdError extends Error {
  constructor() {
    super('Two order-* transactions in the same batch share the same order id (programmer error)');
    this.name = 'DuplicateOrderIdError';
  }
}

export class BatchPartiallyCommittedError extends Error {
  constructor() {
    super('Batch was partially committed by a previous attempt — caller must resolve');
    this.name = 'BatchPartiallyCommittedError';
  }
}

export class IdReuseError extends Error {
  constructor() {
    super('A transaction id in this batch already exists in the log with a different payload');
    this.name = 'IdReuseError';
  }
}

export class AbortError extends Error {
  constructor() {
    super('Operation cancelled');
    this.name = 'AbortError';
  }
}

/**
 * Thrown when the post-PUT verification couldn't be performed (e.g. the
 * recheck read also failed). Callers should NOT roll back side effects
 * like uploaded attachments, since the persisted log may already reference
 * them — admin pruning catches real orphans.
 */
export class WriteIndeterminateError extends Error {
  cause: unknown;
  constructor(cause: unknown) {
    super('Write outcome could not be confirmed — cleanup is not safe');
    this.name = 'WriteIndeterminateError';
    this.cause = cause;
  }
}

/**
 * Thrown when transactions.json contains entries this bundle cannot parse
 * (corrupted or written by a newer bundle). Reads still work for display,
 * but writes are blocked because we can't reason about the side effects of
 * unrecognized entries against derived state.
 */
export class LogContainsUnreadableEntriesError extends Error {
  skippedCount: number;
  constructor(skippedCount: number) {
    super(
      `transactions.json contains ${skippedCount} unreadable entr${skippedCount === 1 ? 'y' : 'ies'} ` +
      `— writes are blocked. Reload the page; if the problem persists, the file may be corrupted ` +
      `or written by a newer version of the app.`,
    );
    this.name = 'LogContainsUnreadableEntriesError';
    this.skippedCount = skippedCount;
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new AbortError());
      return;
    }
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    };
    const onAbort = () => {
      cleanup();
      reject(new AbortError());
    };
    signal?.addEventListener('abort', onAbort);
  });
}

function checkAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new AbortError();
}

function parseTransactionInput(input: TransactionInput): void {
  // Defense in depth: a buggy caller could otherwise persist a TS-typed
  // payload that fails the read-time parse for everyone.
  const parsed = TransactionWriteSchema.safeParse({
    ...input,
    performedBy: 'parse-only@local',
    timestamp: new Date().toISOString(),
  });
  if (!parsed.success) {
    throw new Error(`Invalid transaction payload (${input.type}): ${parsed.error.message}`);
  }
}

/**
 * Validate one staged input. order-* cases use ordersMap (input.itemId is
 * the ORDER's UUID for those types).
 */
function requireItem(itemsMap: Map<string, InventoryItem>, id: string): InventoryItem {
  const item = itemsMap.get(id);
  if (!item) throw new ItemNotFoundError(id);
  return item;
}

function validateTransaction(
  input: TransactionInput,
  itemsMap: Map<string, InventoryItem>,
  ordersMap: Map<string, Order>,
): void {
  switch (input.type) {
    case 'stock-in': {
      requireItem(itemsMap, input.itemId);
      validateStockIn((input.data as StockData).quantity);
      break;
    }
    case 'stock-out': {
      validateStockOut(requireItem(itemsMap, input.itemId), (input.data as StockData).quantity);
      break;
    }
    case 'item-create': {
      validateItemCreate(input.data as ItemCreateData, asArray(itemsMap));
      break;
    }
    case 'item-update': {
      requireItem(itemsMap, input.itemId);
      validateItemUpdate(input.data as ItemUpdateData);
      break;
    }
    case 'item-delete': {
      requireItem(itemsMap, input.itemId);
      // Block deletion if any PLACED order references the item. Received
      // orders are closed historical records; deletion is allowed for them.
      for (const order of ordersMap.values()) {
        if (order.status !== 'placed') continue;
        if (order.lineItems.some((line) => line.itemId === input.itemId)) {
          throw new ItemReferencedByOrderError(input.itemId, order.poNumber);
        }
      }
      break;
    }
    case 'order-create': {
      const d = input.data as OrderCreateData;
      for (const order of ordersMap.values()) {
        if (order.status !== 'cancelled' && order.poNumber === d.poNumber) {
          throw new PoNumberInUseError(d.poNumber);
        }
      }
      for (const line of d.lineItems) {
        requireItem(itemsMap, line.itemId);
      }
      break;
    }
    case 'order-receive': {
      const order = ordersMap.get(input.itemId);
      if (!order) throw new OrderNotFoundError(input.itemId);
      if (order.status !== 'placed') throw new OrderNotPlacedError(order.poNumber, order.status);
      const d = input.data as OrderReceiveData;
      const orderLineIds = order.lineItems.map((l) => l.id).sort();
      const recvLineIds = d.receivedLines.map((r) => r.id).sort();
      if (orderLineIds.length !== recvLineIds.length
          || orderLineIds.some((id, i) => id !== recvLineIds[i])) {
        throw new ReceiveCoverageError(order.poNumber);
      }
      // All-zero receive would close the PO without producing any stock-in
      // and block future receives — route through cancel instead.
      if (!d.receivedLines.some((r) => r.quantityReceived > 0)) {
        throw new EmptyReceiveError(order.poNumber);
      }
      break;
    }
    case 'order-cancel': {
      const order = ordersMap.get(input.itemId);
      if (!order) throw new OrderNotFoundError(input.itemId);
      if (order.status !== 'placed') throw new OrderNotPlacedError(order.poNumber, order.status);
      // replacedBy is informational ONLY — never validated. The staged loop
      // processes cancel BEFORE its replacement order-create.
      break;
    }
  }
}

// validateItemCreate's existing signature takes an array. Other cases use
// the map directly to avoid per-input materialization.
function asArray<T>(map: Map<string, T>): T[] {
  return Array.from(map.values());
}

/**
 * Defends against malformed receive batches: a buggy caller could close a PO
 * (order-receive) while emitting stock-in transactions for unrelated items
 * or quantities. Per-input validation can't catch this — only a cross-input
 * pass that ties each order-receive to its sibling stock-ins can.
 */
function validateReceiveBatchBinding(
  inputs: TransactionInput[],
  ordersMap: Map<string, Order>,
): void {
  const allStockIns = inputs.filter((i) => i.type === 'stock-in');
  const receiveOrderIds = new Set(
    inputs.filter((i) => i.type === 'order-receive').map((i) => i.itemId),
  );

  // Orphan check: a stock-in carrying orderId must belong to a sibling receive.
  for (const s of allStockIns) {
    const oid = (s.data as StockData).orderId;
    if (oid && !receiveOrderIds.has(oid)) {
      throw new ReceiveStockInBindingError(
        oid,
        `stock-in ${s.id} references orderId ${oid} but no sibling order-receive exists in the batch`,
      );
    }
  }

  for (const input of inputs) {
    if (input.type !== 'order-receive') continue;
    const order = ordersMap.get(input.itemId);
    if (!order) continue; // OrderNotFoundError already raised by per-input validate

    const orderId = input.itemId;
    const positives = (input.data as OrderReceiveData).receivedLines.filter(
      (r) => r.quantityReceived > 0,
    );
    const linked = allStockIns.filter((s) => (s.data as StockData).orderId === orderId);

    if (linked.length !== positives.length) {
      throw new ReceiveStockInBindingError(
        order.poNumber,
        `expected ${positives.length} stock-in(s) for PO, got ${linked.length}`,
      );
    }

    const remaining = [...linked];
    for (const r of positives) {
      const line = order.lineItems.find((l) => l.id === r.id);
      if (!line) continue; // ReceiveCoverageError already raised by per-input validate
      const idx = remaining.findIndex((s) => {
        const d = s.data as StockData;
        return s.itemId === line.itemId
          && d.quantity === r.quantityReceived
          && (d.lotNumber ?? null) === (r.lotNumber ?? null)
          && (d.expirationDate ?? null) === (r.expirationDate ?? null);
      });
      if (idx === -1) {
        throw new ReceiveStockInBindingError(
          order.poNumber,
          `no matching stock-in for line ${r.id} (item=${line.itemId} qty=${r.quantityReceived} lot=${r.lotNumber ?? '∅'} exp=${r.expirationDate ?? '∅'})`,
        );
      }
      remaining.splice(idx, 1);
    }
  }
}

/**
 * appendTransactions — atomic batch write with retry/backoff.
 *
 * Inputs MUST have stable identity across retries: caller pre-rolls all UUIDs
 * (incl. stub item ids/SKUs). The retry loop never re-rolls, so idempotency
 * guarantees hold.
 */
export async function appendTransactions(
  inputs: TransactionInput[],
  signal?: AbortSignal,
): Promise<WriteResult> {
  if (inputs.length === 0) {
    throw new Error('appendTransactions called with empty input');
  }

  // Pre-input duplicate-id check (programmer error)
  const seenIds = new Set<string>();
  for (const input of inputs) {
    if (seenIds.has(input.id)) throw new DuplicateInputIdError();
    seenIds.add(input.id);
  }
  const seenOrderIds = new Set<string>();
  for (const input of inputs) {
    if (input.type === 'order-create' || input.type === 'order-receive' || input.type === 'order-cancel') {
      if (seenOrderIds.has(input.itemId)) throw new DuplicateOrderIdError();
      seenOrderIds.add(input.itemId);
    }
  }

  for (const input of inputs) {
    parseTransactionInput(input);
  }

  let attempt = 0;

  while (attempt <= MAX_RETRIES) {
    checkAborted(signal);

    const result = await readTransactionLog();
    checkAborted(signal);

    // If the loaded log contains entries we can't parse, refuse to write.
    // Writing against `known` would compound corruption: e.g. a stock-out we
    // skipped would leave our quantity stale, and we'd validate the next
    // stock-out against the wrong baseline. (Idempotent retries — full match
    // on existing IDs — are still allowed below since they don't mutate.)
    const skipped = result.data.transactions.length - result.known.length;

    // Idempotency analysis against the RAW transactions array
    const existingIds = new Set<string>();
    for (const entry of result.data.transactions) {
      const id = (entry as { id?: unknown })?.id;
      if (typeof id === 'string') existingIds.add(id);
    }
    const inputIds = inputs.map((i) => i.id);
    const presentInputIds = inputIds.filter((id) => existingIds.has(id));

    if (presentInputIds.length === inputIds.length) {
      // Full match: every input id already exists. Validate they match in
      // type/itemId/data (no IdReuseError).
      const knownById = new Map(result.known.map((tx) => [tx.id, tx]));
      let mismatch = false;
      for (const input of inputs) {
        const known = knownById.get(input.id);
        if (!known) { mismatch = true; break; }
        if (known.type !== input.type || known.itemId !== input.itemId) {
          mismatch = true; break;
        }
        if (JSON.stringify(known.data) !== JSON.stringify(input.data)) {
          mismatch = true; break;
        }
      }
      if (mismatch) throw new IdReuseError();
      return {
        transactions: result.data.transactions,
        known: result.known,
        items: Array.from(deriveInventoryMap(result.known).values()),
        orders: Array.from(deriveOrdersMap(result.known).values()),
      };
    }
    if (presentInputIds.length > 0) {
      throw new BatchPartiallyCommittedError();
    }

    // None of our IDs are in the log — proceed to write. From here on, refuse
    // if the log has unreadable entries: writing would silently lose the
    // ability to reason about derived state.
    if (skipped > 0) {
      throw new LogContainsUnreadableEntriesError(skipped);
    }

    // Build initial derived state from the known log.
    const itemsMap = deriveInventoryMap(result.known);
    const ordersMap = deriveOrdersMap(result.known);

    const stamped: Transaction[] = [];
    const performedBy = getCurrentUserEmail();
    const commitTimestamp = new Date().toISOString();

    for (const input of inputs) {
      validateTransaction(input, itemsMap, ordersMap);
      const stampedTx: Transaction = { ...input, performedBy, timestamp: commitTimestamp };
      // Incremental in-place apply — O(1) per input for the maps; keeps
      // intra-batch dependencies visible (e.g. quick-add item visible to
      // the next order-create's line-resolution check).
      applyToInventoryMap(itemsMap, [stampedTx]);
      applyToOrdersMap(ordersMap, [stampedTx]);
      stamped.push(stampedTx);
    }

    // Cross-input invariant: every order-receive must be backed by exactly
    // one stock-in per positive received line, with matching itemId, quantity,
    // lot, and expiration; conversely, every stock-in carrying an orderId
    // must belong to a sibling order-receive in the batch.
    validateReceiveBatchBinding(inputs, ordersMap);

    const newRaw = [...result.data.transactions, ...stamped];
    const updatedLog: TransactionLogRaw = {
      schemaVersion: 2,
      transactions: newRaw,
    };

    checkAborted(signal);

    try {
      await writeTransactionLog(updatedLog, result.eTag);
      return {
        transactions: newRaw,
        known: [...result.known, ...stamped],
        items: Array.from(itemsMap.values()),
        orders: Array.from(ordersMap.values()),
      };
    } catch (err) {
      if (err instanceof ConflictError && attempt < MAX_RETRIES) {
        const delay = BASE_DELAY_MS * Math.pow(2, attempt) + Math.random() * BASE_DELAY_MS;
        await sleep(delay, signal);
        attempt++;
        continue;
      }
      // Non-conflict failure (timeout, dropped response, parse failure on the
      // 200, etc.). The PUT may have actually landed server-side. Re-read to
      // disambiguate before propagating — otherwise callers' rollback logic
      // (e.g. attachment cleanup) could orphan files referenced by a
      // committed log entry.
      const stampedIds = new Set(stamped.map((t) => t.id));
      try {
        const verify = await readTransactionLog();
        let landed = 0;
        for (const entry of verify.data.transactions) {
          const id = (entry as { id?: unknown })?.id;
          if (typeof id === 'string' && stampedIds.has(id)) landed++;
        }
        if (landed === stampedIds.size) {
          // Silent success — return verify's state.
          return {
            transactions: verify.data.transactions,
            known: verify.known,
            items: Array.from(deriveInventoryMap(verify.known).values()),
            orders: Array.from(deriveOrdersMap(verify.known).values()),
          };
        }
        if (landed === 0) {
          // Definitely failed — original error is accurate, callers can roll back.
          throw err;
        }
        // Partial commit visible — surface as a hard error; rolling back is
        // dangerous because some IDs are persisted.
        throw new BatchPartiallyCommittedError();
      } catch (recheckErr) {
        // BatchPartiallyCommittedError is the only thing we re-throw above.
        if (recheckErr instanceof BatchPartiallyCommittedError) throw recheckErr;
        if (recheckErr === err) throw err;
        throw new WriteIndeterminateError(err);
      }
    }
  }

  throw new Error(`Failed to append transactions after ${MAX_RETRIES} retries`);
}

/**
 * Single-input wrapper. Reuses appendTransactions so retry / idempotency /
 * raw-round-trip behavior never drifts between the two surfaces.
 */
export async function appendTransaction(
  input: TransactionInput,
  signal?: AbortSignal,
): Promise<WriteResult> {
  return appendTransactions([input], signal);
}

export function createTransactionInput(
  type: TransactionInput['type'],
  itemId: string,
  data: TransactionInput['data'],
): TransactionInput {
  return { id: uuidv4(), type, itemId, data };
}
