import { describe, it, expect } from 'vitest';
import { deriveInventory } from '../deriveState';
import type { Transaction } from '../../models/transaction';

function tx(overrides: Partial<Transaction> & Pick<Transaction, 'type' | 'itemId' | 'data'>): Transaction {
  return {
    id: crypto.randomUUID(),
    performedBy: 'test@company.com',
    timestamp: '2026-04-03T10:00:00Z',
    ...overrides,
  };
}

const baseCreate = {
  sku: 'A', name: 'Item A', quantity: 0, location: 'Room 1', category: 'Cat',
  supplier: 'Sup', unitCost: 0, reorderPoint: 0, vendor: '', referenceNumber: '',
};

describe('deriveInventory', () => {
  it('returns empty array for empty log', () => {
    expect(deriveInventory([])).toEqual([]);
  });

  it('creates an item from item-create', () => {
    const items = deriveInventory([
      tx({
        type: 'item-create',
        itemId: 'item-1',
        data: { ...baseCreate, sku: 'PCR-001', name: 'PCR Tubes', quantity: 100, lotNumber: 'LOT-A', expirationDate: '2027-01-01' },
      }),
    ]);
    expect(items).toHaveLength(1);
    expect(items[0].sku).toBe('PCR-001');
    expect(items[0].quantity).toBe(100);
    expect(items[0].batches).toHaveLength(1);
    expect(items[0].batches[0].lotNumber).toBe('LOT-A');
    expect(items[0].earliestExpiration).toBe('2027-01-01');
  });

  it('increases quantity on stock-in and adds a batch', () => {
    const items = deriveInventory([
      tx({ type: 'item-create', itemId: 'item-1', data: { ...baseCreate, quantity: 10 } }),
      tx({ type: 'stock-in', itemId: 'item-1', data: { quantity: 25, lotNumber: 'LOT-B', expirationDate: '2027-06-01' } }),
    ]);
    expect(items[0].quantity).toBe(35);
    expect(items[0].batches).toHaveLength(2);
    expect(items[0].earliestExpiration).toBe('2027-06-01');
  });

  it('stock-out consumes from earliest-expiring batch (FEFO)', () => {
    const items = deriveInventory([
      tx({ type: 'item-create', itemId: 'item-1', data: { ...baseCreate, quantity: 0 } }),
      tx({ type: 'stock-in', itemId: 'item-1', data: { quantity: 10, lotNumber: 'OLD', expirationDate: '2026-06-01' } }),
      tx({ type: 'stock-in', itemId: 'item-1', data: { quantity: 20, lotNumber: 'NEW', expirationDate: '2027-01-01' } }),
      tx({ type: 'stock-out', itemId: 'item-1', data: { quantity: 8 } }),
    ]);
    expect(items[0].quantity).toBe(22);
    // OLD batch should have 2 remaining (10-8), NEW untouched at 20
    expect(items[0].batches).toHaveLength(2);
    const oldBatch = items[0].batches.find(b => b.lotNumber === 'OLD');
    const newBatch = items[0].batches.find(b => b.lotNumber === 'NEW');
    expect(oldBatch?.quantity).toBe(2);
    expect(newBatch?.quantity).toBe(20);
    expect(items[0].earliestExpiration).toBe('2026-06-01');
  });

  it('depletes a batch fully and moves to next', () => {
    const items = deriveInventory([
      tx({ type: 'item-create', itemId: 'item-1', data: { ...baseCreate, quantity: 0 } }),
      tx({ type: 'stock-in', itemId: 'item-1', data: { quantity: 5, lotNumber: 'OLD', expirationDate: '2026-06-01' } }),
      tx({ type: 'stock-in', itemId: 'item-1', data: { quantity: 20, lotNumber: 'NEW', expirationDate: '2027-01-01' } }),
      tx({ type: 'stock-out', itemId: 'item-1', data: { quantity: 12 } }),
    ]);
    expect(items[0].quantity).toBe(13);
    // OLD batch fully consumed, NEW has 13 remaining (20 - 7)
    expect(items[0].batches).toHaveLength(1);
    expect(items[0].batches[0].lotNumber).toBe('NEW');
    expect(items[0].batches[0].quantity).toBe(13);
    expect(items[0].earliestExpiration).toBe('2027-01-01');
  });

  it('merges fields on item-update without affecting batches', () => {
    const items = deriveInventory([
      tx({ type: 'item-create', itemId: 'item-1', data: { ...baseCreate, name: 'Old', quantity: 10, lotNumber: 'L1', expirationDate: '2027-01-01' } }),
      tx({ type: 'item-update', itemId: 'item-1', data: { name: 'New Name', location: 'Room 2' } }),
    ]);
    expect(items[0].name).toBe('New Name');
    expect(items[0].location).toBe('Room 2');
    expect(items[0].batches).toHaveLength(1); // batches unchanged
  });

  it('removes item on item-delete', () => {
    const items = deriveInventory([
      tx({ type: 'item-create', itemId: 'item-1', data: { ...baseCreate, quantity: 10 } }),
      tx({ type: 'item-delete', itemId: 'item-1', data: {} }),
    ]);
    expect(items).toHaveLength(0);
  });

  it('handles multiple items with interleaved transactions', () => {
    const items = deriveInventory([
      tx({ type: 'item-create', itemId: 'a', data: { ...baseCreate, sku: 'A', name: 'ItemA', quantity: 100, unitCost: 1, reorderPoint: 10 } }),
      tx({ type: 'item-create', itemId: 'b', data: { ...baseCreate, sku: 'B', name: 'ItemB', quantity: 50, unitCost: 2, reorderPoint: 5 } }),
      tx({ type: 'stock-out', itemId: 'a', data: { quantity: 30 } }),
      tx({ type: 'stock-in', itemId: 'b', data: { quantity: 10, lotNumber: 'L2', expirationDate: '2027-06-01' } }),
      tx({ type: 'item-delete', itemId: 'a', data: {} }),
    ]);
    expect(items).toHaveLength(1);
    expect(items[0].sku).toBe('B');
    expect(items[0].quantity).toBe(60);
  });

  it('batches without expiration sort after those with expiration', () => {
    const items = deriveInventory([
      tx({ type: 'item-create', itemId: 'item-1', data: { ...baseCreate, quantity: 0 } }),
      tx({ type: 'stock-in', itemId: 'item-1', data: { quantity: 10, lotNumber: 'NO-EXP' } }),
      tx({ type: 'stock-in', itemId: 'item-1', data: { quantity: 5, lotNumber: 'HAS-EXP', expirationDate: '2027-03-01' } }),
    ]);
    // Batch with expiration should come first in FEFO order
    expect(items[0].batches[0].lotNumber).toBe('HAS-EXP');
    expect(items[0].batches[1].lotNumber).toBe('NO-EXP');
    expect(items[0].earliestExpiration).toBe('2027-03-01');
  });
});
