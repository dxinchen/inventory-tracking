import { describe, it, expect, vi } from 'vitest';
import { deriveOrders, deriveInventory } from '../deriveState';
import type { Transaction } from '../../models/transaction';

const validUuid = () => crypto.randomUUID();

function tx(overrides: Partial<Transaction> & Pick<Transaction, 'type' | 'itemId' | 'data'>): Transaction {
  return {
    id: validUuid(),
    performedBy: 'test@company.com',
    timestamp: '2026-04-03T10:00:00Z',
    ...overrides,
  };
}

const baseLine = () => ({
  id: validUuid(), itemId: validUuid(), name: 'PCR Tubes',
  unitOfMeasure: 'box', quantityOrdered: 10, unitCost: 42,
});

describe('deriveOrders', () => {
  it('returns empty for an empty log', () => {
    expect(deriveOrders([])).toEqual([]);
  });

  it('produces a placed order from order-create', () => {
    const orderId = validUuid();
    const orders = deriveOrders([
      tx({
        type: 'order-create', itemId: orderId,
        data: {
          poNumber: 'PO-2026-0001', orderConfirmationNumber: 'CONF-1',
          supplier: 'Qiagen', orderDate: '2026-05-09',
          lineItems: [baseLine()],
        },
      }),
    ]);
    expect(orders).toHaveLength(1);
    expect(orders[0].status).toBe('placed');
    expect(orders[0].poNumber).toBe('PO-2026-0001');
  });

  it('flips status to received and stamps actualReceiveDate on order-receive', () => {
    const orderId = validUuid();
    const line = baseLine();
    const orders = deriveOrders([
      tx({
        type: 'order-create', itemId: orderId,
        data: {
          poNumber: 'PO-2026-0001', orderConfirmationNumber: 'CONF-1',
          supplier: 'Qiagen', orderDate: '2026-05-09',
          lineItems: [line],
        },
      }),
      tx({
        type: 'order-receive', itemId: orderId,
        data: {
          actualReceiveDate: '2026-05-12',
          receivedLines: [{
            id: line.id, quantityReceived: 8, lotNumber: 'LOT-A', expirationDate: '2027-01-01',
          }],
        },
      }),
    ]);
    expect(orders[0].status).toBe('received');
    expect(orders[0].actualReceiveDate).toBe('2026-05-12');
    expect(orders[0].lineItems[0].quantityReceived).toBe(8);
    expect(orders[0].lineItems[0].lotNumber).toBe('LOT-A');
  });

  it('flips status to cancelled on order-cancel', () => {
    const orderId = validUuid();
    const orders = deriveOrders([
      tx({
        type: 'order-create', itemId: orderId,
        data: {
          poNumber: 'PO-2026-0001', orderConfirmationNumber: 'CONF-1',
          supplier: 'Qiagen', orderDate: '2026-05-09',
          lineItems: [baseLine()],
        },
      }),
      tx({
        type: 'order-cancel', itemId: orderId,
        data: { note: 'Mis-ordered', replacedBy: validUuid() },
      }),
    ]);
    expect(orders[0].status).toBe('cancelled');
    expect(orders[0].note).toBe('Mis-ordered');
  });

  it('ignores order-receive that targets unknown order id', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const orders = deriveOrders([
      tx({
        type: 'order-receive', itemId: validUuid(),
        data: {
          actualReceiveDate: '2026-05-12',
          receivedLines: [{ id: validUuid(), quantityReceived: 0 }],
        },
      }),
    ]);
    expect(orders).toEqual([]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('deriveInventory + deriveOrders disjointness', () => {
  it('produces disjoint id sets on a representative log', () => {
    const itemId = validUuid();
    const orderId = validUuid();
    const log: Transaction[] = [
      tx({ type: 'item-create', itemId, data: { sku: 'A', name: 'X', quantity: 0, location: 'A', category: 'B', supplier: 'C', reorderPoint: 0, vendor: '', referenceNumber: '' } }),
      tx({ type: 'order-create', itemId: orderId, data: {
        poNumber: 'PO-1', orderConfirmationNumber: 'C-1',
        supplier: 'S', orderDate: '2026-05-09',
        lineItems: [{ id: validUuid(), itemId, name: 'X', unitOfMeasure: 'each', quantityOrdered: 1, unitCost: 0 }],
      } }),
    ];
    const items = deriveInventory(log);
    const orders = deriveOrders(log);
    const itemIds = new Set(items.map((i) => i.id));
    const orderIds = new Set(orders.map((o) => o.id));
    for (const id of itemIds) expect(orderIds.has(id)).toBe(false);
    for (const id of orderIds) expect(itemIds.has(id)).toBe(false);
  });

  it('defensive-ignore: a tx whose itemId collides with the other id-space gets logged and skipped', () => {
    // When a UUID collision occurs between an order-create's itemId (the
    // order's id) and an item-create's itemId, both branches refuse to
    // process the colliding id rather than risk silently treating an order
    // event as an item event or vice versa. This is conservative — better
    // to lose one of the two records than to corrupt either side.
    const orderId = validUuid();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const log: Transaction[] = [
      tx({ type: 'order-create', itemId: orderId, data: {
        poNumber: 'PO-X', orderConfirmationNumber: 'C-X',
        supplier: 'S', orderDate: '2026-05-09', lineItems: [baseLine()],
      } }),
      tx({ type: 'item-create', itemId: orderId, data: {
        sku: 'INVALID', name: 'X', quantity: 0, location: 'A', category: 'B',
        supplier: 'C', reorderPoint: 0, vendor: '', referenceNumber: '',
      } }),
    ];
    const items = deriveInventory(log);
    const orders = deriveOrders(log);
    // Both sides defensively ignore the collision — neither corrupted record
    // ends up in the derived state.
    expect(items.length + orders.length).toBe(0);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('isStub graduation monotonicity', () => {
  it('flips isStub: true → false on first stock-in and never reverts', () => {
    const itemId = validUuid();
    const items = deriveInventory([
      tx({ type: 'item-create', itemId, data: {
        sku: 'STUB-1', name: 'Stub', quantity: 0, location: 'A', category: 'B',
        supplier: 'C', reorderPoint: 0, vendor: '', referenceNumber: '', isStub: true,
      } }),
      tx({ type: 'stock-in', itemId, data: { quantity: 5 } }),
      tx({ type: 'stock-out', itemId, data: { quantity: 5 } }),
    ]);
    expect(items[0].isStub).toBe(false);
    expect(items[0].quantity).toBe(0);
  });

  it('item-update with isStub: false graduates the stub', () => {
    const itemId = validUuid();
    let items = deriveInventory([
      tx({ type: 'item-create', itemId, data: {
        sku: 'STUB-2', name: 'Stub', quantity: 0, location: 'A', category: 'B',
        supplier: 'C', reorderPoint: 0, vendor: '', referenceNumber: '', isStub: true,
      } }),
    ]);
    expect(items[0].isStub).toBe(true);
    items = deriveInventory([
      tx({ type: 'item-create', itemId, data: {
        sku: 'STUB-2', name: 'Stub', quantity: 0, location: 'A', category: 'B',
        supplier: 'C', reorderPoint: 0, vendor: '', referenceNumber: '', isStub: true,
      } }),
      tx({ type: 'item-update', itemId, data: { isStub: false, name: 'Real' } }),
    ]);
    expect(items[0].isStub).toBe(false);
    expect(items[0].name).toBe('Real');
  });
});

