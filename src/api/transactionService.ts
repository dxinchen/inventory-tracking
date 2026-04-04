import { v4 as uuidv4 } from 'uuid';
import type { Transaction, TransactionInput, TransactionLog, ItemCreateData, StockData } from '../models/transaction';
import type { InventoryItem } from '../models/inventory';
import { readTransactionLog, writeTransactionLog } from './fileOperations';
import { deriveInventory } from '../utils/deriveState';
import {
  validateStockIn,
  validateStockOut,
  validateItemCreate,
  validateItemUpdate,
  validateItemExists,
  InsufficientStockError,
} from '../utils/validation';
import { ConflictError } from './graphClient';
import { msalInstance } from '../auth/AuthProvider';

const MAX_RETRIES = 3;

/**
 * Get the current user's email from the active MSAL account.
 */
function getCurrentUserEmail(): string {
  const account = msalInstance.getActiveAccount();
  if (!account) throw new Error('Not authenticated');
  return account.username;
}

/**
 * Append a transaction to the log with conflict retry.
 *
 * Callers provide TransactionInput (id, type, itemId, data).
 * This function stamps performedBy + timestamp internally.
 *
 * On 412 Precondition Failed: re-reads, checks idempotency,
 * re-derives state, revalidates business rules, and retries.
 */
export async function appendTransaction(
  input: TransactionInput,
): Promise<InventoryItem[]> {
  let retries = 0;

  while (retries <= MAX_RETRIES) {
    // 1. Read current transaction log
    const { data: log, eTag } = await readTransactionLog();

    // 2. Idempotency check: if this transaction ID already exists, no-op
    if (log.transactions.some((tx) => tx.id === input.id)) {
      return deriveInventory(log.transactions);
    }

    // 3. Derive current state
    const items = deriveInventory(log.transactions);

    // 4. Validate business rules
    validateTransaction(input, items);

    // 5. Build full transaction with audit fields
    const transaction: Transaction = {
      ...input,
      performedBy: getCurrentUserEmail(),
      timestamp: new Date().toISOString(),
    };

    // 6. Append to log
    const updatedLog: TransactionLog = {
      transactions: [...log.transactions, transaction],
    };

    // 7. Write back with eTag
    try {
      await writeTransactionLog(updatedLog, eTag);
      return deriveInventory(updatedLog.transactions);
    } catch (err) {
      if (err instanceof ConflictError && retries < MAX_RETRIES) {
        retries++;
        continue; // Re-read, re-validate, retry
      }
      throw err;
    }
  }

  throw new Error(`Failed to append transaction after ${MAX_RETRIES} retries`);
}

/**
 * Validate a transaction against the current derived state.
 */
function validateTransaction(
  input: TransactionInput,
  items: InventoryItem[],
): void {
  switch (input.type) {
    case 'stock-in': {
      const item = validateItemExists(input.itemId, items);
      validateStockIn((input.data as StockData).quantity);
      void item; // exists check is sufficient
      break;
    }

    case 'stock-out': {
      const item = validateItemExists(input.itemId, items);
      validateStockOut(item, (input.data as StockData).quantity);
      break;
    }

    case 'item-create': {
      validateItemCreate(input.data as ItemCreateData, items);
      break;
    }

    case 'item-update': {
      validateItemExists(input.itemId, items);
      validateItemUpdate(input.data as Parameters<typeof validateItemUpdate>[0]);
      break;
    }

    case 'item-delete': {
      validateItemExists(input.itemId, items);
      break;
    }
  }
}

/**
 * Helper to create a new TransactionInput with a generated UUID.
 */
export function createTransactionInput(
  type: TransactionInput['type'],
  itemId: string,
  data: TransactionInput['data'],
): TransactionInput {
  return { id: uuidv4(), type, itemId, data };
}
