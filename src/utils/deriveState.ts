import type { Transaction, ItemCreateData, ItemUpdateData, StockData } from '../models/transaction';
import type { InventoryItem, Batch } from '../models/inventory';

/**
 * Sort batches by expiration date (earliest first).
 * Batches without expiration go to the end.
 */
function sortBatchesFEFO(batches: Batch[]): Batch[] {
  return [...batches].sort((a, b) => {
    if (!a.expirationDate && !b.expirationDate) return 0;
    if (!a.expirationDate) return 1;  // no expiry → last
    if (!b.expirationDate) return -1;
    return a.expirationDate.localeCompare(b.expirationDate);
  });
}

/**
 * Get the earliest expiration date across batches that still have quantity.
 */
function getEarliestExpiration(batches: Batch[]): string {
  for (const batch of sortBatchesFEFO(batches)) {
    if (batch.quantity > 0 && batch.expirationDate) {
      return batch.expirationDate;
    }
  }
  return '';
}

/**
 * Consume quantity from batches using FEFO (First Expired, First Out).
 * Returns updated batches array with reduced quantities.
 */
function consumeFEFO(batches: Batch[], qty: number): Batch[] {
  const sorted = sortBatchesFEFO(batches);
  let remaining = qty;

  return sorted.map(batch => {
    if (remaining <= 0 || batch.quantity <= 0) return batch;
    const take = Math.min(batch.quantity, remaining);
    remaining -= take;
    return { ...batch, quantity: batch.quantity - take };
  }).filter(b => b.quantity > 0); // remove depleted batches
}

/**
 * Derive current inventory state by replaying the full transaction log in order.
 * This is the single source of truth — no persisted snapshot.
 *
 * Batch tracking: each stock-in creates a batch with its own lot/expiration.
 * Stock-out consumes from earliest-expiring batches first (FEFO).
 */
export function deriveInventory(transactions: Transaction[]): InventoryItem[] {
  const items = new Map<string, InventoryItem>();

  for (const tx of transactions) {
    switch (tx.type) {
      case 'item-create': {
        const d = tx.data as ItemCreateData;
        const batches: Batch[] = [];
        // If created with initial quantity, create a batch
        if (d.quantity > 0) {
          batches.push({
            lotNumber: d.lotNumber || 'INIT',
            expirationDate: d.expirationDate || '',
            quantity: d.quantity,
            receivedAt: tx.timestamp,
          });
        }
        items.set(tx.itemId, {
          id: tx.itemId,
          sku: d.sku,
          name: d.name,
          quantity: d.quantity,
          location: d.location,
          category: d.category,
          supplier: d.supplier,
          unitCost: d.unitCost ?? undefined,
          reorderPoint: d.reorderPoint,
          vendor: d.vendor,
          referenceNumber: d.referenceNumber,
          imageFilename: d.imageFilename,
          createdBy: tx.performedBy,
          updatedAt: tx.timestamp,
          batches: sortBatchesFEFO(batches),
          earliestExpiration: getEarliestExpiration(batches),
        });
        break;
      }

      case 'item-update': {
        const existing = items.get(tx.itemId);
        if (!existing) break;
        const d = tx.data as ItemUpdateData;
        items.set(tx.itemId, {
          ...existing,
          ...Object.fromEntries(Object.entries(d).filter(([, v]) => v !== undefined)),
          updatedAt: tx.timestamp,
        });
        break;
      }

      case 'item-delete': {
        items.delete(tx.itemId);
        break;
      }

      case 'stock-in': {
        const existing = items.get(tx.itemId);
        if (!existing) break;
        const d = tx.data as StockData;
        const newBatch: Batch = {
          lotNumber: d.lotNumber || `LOT-${tx.id.slice(0, 8)}`,
          expirationDate: d.expirationDate || '',
          quantity: d.quantity,
          receivedAt: tx.timestamp,
        };
        const batches = sortBatchesFEFO([...existing.batches, newBatch]);
        items.set(tx.itemId, {
          ...existing,
          quantity: existing.quantity + d.quantity,
          batches,
          earliestExpiration: getEarliestExpiration(batches),
          updatedAt: tx.timestamp,
        });
        break;
      }

      case 'stock-out': {
        const existing = items.get(tx.itemId);
        if (!existing) break;
        const d = tx.data as StockData;
        const batches = consumeFEFO(existing.batches, d.quantity);
        items.set(tx.itemId, {
          ...existing,
          quantity: existing.quantity - d.quantity,
          batches,
          earliestExpiration: getEarliestExpiration(batches),
          updatedAt: tx.timestamp,
        });
        break;
      }
    }
  }

  return Array.from(items.values());
}
