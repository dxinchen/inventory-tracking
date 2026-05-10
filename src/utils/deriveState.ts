import type {
  Transaction,
  ItemCreateData,
  ItemUpdateData,
  StockData,
  OrderCreateData,
  OrderReceiveData,
  OrderCancelData,
} from '../models/transaction';
import type { InventoryItem, Batch } from '../models/inventory';
import type { Order, OrderLineItem, OrderAttachment } from '../models/order';

function sortBatchesFEFO(batches: Batch[]): Batch[] {
  return [...batches].sort((a, b) => {
    if (!a.expirationDate && !b.expirationDate) return 0;
    if (!a.expirationDate) return 1;
    if (!b.expirationDate) return -1;
    return a.expirationDate.localeCompare(b.expirationDate);
  });
}

function getEarliestExpiration(batches: Batch[]): string {
  for (const batch of sortBatchesFEFO(batches)) {
    if (batch.quantity > 0 && batch.expirationDate) {
      return batch.expirationDate;
    }
  }
  return '';
}

function consumeFEFO(batches: Batch[], qty: number): Batch[] {
  const sorted = sortBatchesFEFO(batches);
  let remaining = qty;
  return sorted.map((batch) => {
    if (remaining <= 0 || batch.quantity <= 0) return batch;
    const take = Math.min(batch.quantity, remaining);
    remaining -= take;
    return { ...batch, quantity: batch.quantity - take };
  }).filter((b) => b.quantity > 0);
}

/**
 * Pre-scan a log to collect the id sets used by both derivers, so we can
 * detect cross-space ID collisions in a single pass.
 */
function collectIdSets(transactions: Transaction[]): { itemIds: Set<string>; orderIds: Set<string> } {
  const itemIds = new Set<string>();
  const orderIds = new Set<string>();
  for (const tx of transactions) {
    if (tx.type === 'item-create') itemIds.add(tx.itemId);
    else if (tx.type === 'item-delete') itemIds.delete(tx.itemId);
    else if (tx.type === 'order-create' || tx.type === 'order-receive' || tx.type === 'order-cancel') {
      orderIds.add(tx.itemId);
    }
  }
  return { itemIds, orderIds };
}

/**
 * Apply transactions to an existing inventory map (mutates in place). Used
 * for both fresh derivation (start from empty Map) and incremental updates.
 *
 * `knownOrderIds` enables the disjointness guard — pass null to skip it.
 */
export function applyToInventoryMap(
  items: Map<string, InventoryItem>,
  transactions: Transaction[],
  knownOrderIds: Set<string> | null = null,
): void {
  for (const tx of transactions) {
    if (knownOrderIds?.has(tx.itemId)
        && (tx.type === 'item-create' || tx.type === 'item-update' || tx.type === 'item-delete'
            || tx.type === 'stock-in' || tx.type === 'stock-out')) {
      console.warn(`[deriveInventory] item/stock tx ${tx.id} references order id ${tx.itemId} — ignored`);
      continue;
    }

    switch (tx.type) {
      case 'item-create': {
        const d = tx.data as ItemCreateData;
        const batches: Batch[] = d.quantity > 0 ? [{
          lotNumber: d.lotNumber || 'INIT',
          expirationDate: d.expirationDate || '',
          quantity: d.quantity,
          receivedAt: tx.timestamp,
        }] : [];
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
          unitOfMeasure: d.unitOfMeasure || 'each',
          isStub: d.isStub === true,
          batches: sortBatchesFEFO(batches),
          earliestExpiration: getEarliestExpiration(batches),
        });
        break;
      }

      case 'item-update': {
        const existing = items.get(tx.itemId);
        if (!existing) break;
        const d = tx.data as ItemUpdateData;
        const merged: InventoryItem = {
          ...existing,
          ...Object.fromEntries(Object.entries(d).filter(([, v]) => v !== undefined)),
          updatedAt: tx.timestamp,
        };
        // Stub graduation is monotonic — once false, stays false.
        if (existing.isStub === false) merged.isStub = false;
        items.set(tx.itemId, merged);
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
        const newQty = existing.quantity + d.quantity;
        items.set(tx.itemId, {
          ...existing,
          quantity: newQty,
          batches,
          earliestExpiration: getEarliestExpiration(batches),
          updatedAt: tx.timestamp,
          isStub: existing.isStub && newQty > 0 ? false : existing.isStub,
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
}

/**
 * Apply order-* transactions to an existing orders map (mutates in place).
 */
export function applyToOrdersMap(
  orders: Map<string, Order>,
  transactions: Transaction[],
  knownItemIds: Set<string> | null = null,
): void {
  for (const tx of transactions) {
    if (knownItemIds?.has(tx.itemId)
        && (tx.type === 'order-create' || tx.type === 'order-receive' || tx.type === 'order-cancel')) {
      console.warn(`[deriveOrders] order tx ${tx.id} references known item id ${tx.itemId} — ignored`);
      continue;
    }

    switch (tx.type) {
      case 'order-create': {
        const d = tx.data as OrderCreateData;
        const lineItems: OrderLineItem[] = d.lineItems.map((line) => ({
          id: line.id,
          itemId: line.itemId,
          name: line.name,
          unitOfMeasure: line.unitOfMeasure,
          quantityOrdered: line.quantityOrdered,
          quantityReceived: null,
          unitCost: line.unitCost,
          lotNumber: null,
          expirationDate: null,
        }));
        const placedAttachments: OrderAttachment[] = (d.attachments || []).map((a) => ({
          ...a, stage: 'placed' as const,
        }));
        orders.set(tx.itemId, {
          id: tx.itemId,
          poNumber: d.poNumber,
          orderConfirmationNumber: d.orderConfirmationNumber,
          supplier: d.supplier,
          orderDate: d.orderDate,
          expectedDeliveryDate: d.expectedDeliveryDate ?? null,
          actualReceiveDate: null,
          status: 'placed',
          lineItems,
          attachments: placedAttachments,
          createdBy: tx.performedBy,
          updatedAt: tx.timestamp,
          note: d.note ?? null,
        });
        break;
      }

      case 'order-receive': {
        const existing = orders.get(tx.itemId);
        if (!existing) {
          console.warn(`[deriveOrders] order-receive ${tx.id} targets unknown order ${tx.itemId} — ignored`);
          break;
        }
        const d = tx.data as OrderReceiveData;
        const recvByLineId = new Map(d.receivedLines.map((r) => [r.id, r]));
        const lineItems: OrderLineItem[] = existing.lineItems.map((line) => {
          const r = recvByLineId.get(line.id);
          if (!r) return line;
          return {
            ...line,
            quantityReceived: r.quantityReceived,
            lotNumber: r.lotNumber ?? null,
            expirationDate: r.expirationDate ?? null,
            pastExpirationReason: r.pastExpirationReason,
          };
        });
        const receivedAttachments: OrderAttachment[] = (d.attachments || []).map((a) => ({
          ...a, stage: 'received' as const,
        }));
        orders.set(tx.itemId, {
          ...existing,
          status: 'received',
          actualReceiveDate: d.actualReceiveDate,
          lineItems,
          attachments: [...existing.attachments, ...receivedAttachments],
          updatedAt: tx.timestamp,
        });
        break;
      }

      case 'order-cancel': {
        const existing = orders.get(tx.itemId);
        if (!existing) {
          console.warn(`[deriveOrders] order-cancel ${tx.id} targets unknown order ${tx.itemId} — ignored`);
          break;
        }
        const d = tx.data as OrderCancelData;
        orders.set(tx.itemId, {
          ...existing,
          status: 'cancelled',
          note: d.note ?? existing.note,
          updatedAt: tx.timestamp,
        });
        break;
      }
    }
  }
}

export function deriveInventoryMap(transactions: Transaction[]): Map<string, InventoryItem> {
  const { orderIds } = collectIdSets(transactions);
  const items = new Map<string, InventoryItem>();
  applyToInventoryMap(items, transactions, orderIds);
  return items;
}

export function deriveOrdersMap(transactions: Transaction[]): Map<string, Order> {
  const { itemIds } = collectIdSets(transactions);
  const orders = new Map<string, Order>();
  applyToOrdersMap(orders, transactions, itemIds);
  return orders;
}

export function deriveInventory(transactions: Transaction[]): InventoryItem[] {
  return Array.from(deriveInventoryMap(transactions).values());
}

export function deriveOrders(transactions: Transaction[]): Order[] {
  return Array.from(deriveOrdersMap(transactions).values());
}
