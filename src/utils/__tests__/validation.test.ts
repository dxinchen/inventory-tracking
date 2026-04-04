import { describe, it, expect } from 'vitest';
import {
  validateStockOut,
  validateStockIn,
  validateItemCreate,
  validateItemUpdate,
  validateItemExists,
  InsufficientStockError,
  ItemNotFoundError,
  DuplicateSkuError,
} from '../validation';
import type { InventoryItem } from '../../models/inventory';

const makeItem = (overrides: Partial<InventoryItem> = {}): InventoryItem => ({
  id: 'item-1',
  sku: 'WDG-001',
  name: 'Blue Widget',
  quantity: 50,
  location: 'Bay A',
  category: 'Widgets',
  supplier: 'Acme',
  unitCost: 4.99,
  reorderPoint: 10,
  expirationDate: '',
  createdBy: 'test@company.com',
  updatedAt: '2026-04-03T10:00:00Z',
  ...overrides,
});

describe('validateStockOut', () => {
  it('passes with sufficient stock', () => {
    expect(() => validateStockOut(makeItem({ quantity: 50 }), 30)).not.toThrow();
  });

  it('passes when using exactly all stock', () => {
    expect(() => validateStockOut(makeItem({ quantity: 50 }), 50)).not.toThrow();
  });

  it('throws InsufficientStockError when exceeding stock', () => {
    expect(() => validateStockOut(makeItem({ quantity: 10 }), 20)).toThrow(InsufficientStockError);
  });

  it('throws on zero quantity', () => {
    expect(() => validateStockOut(makeItem(), 0)).toThrow('greater than 0');
  });

  it('throws on negative quantity', () => {
    expect(() => validateStockOut(makeItem(), -5)).toThrow('greater than 0');
  });
});

describe('validateStockIn', () => {
  it('passes with positive quantity', () => {
    expect(() => validateStockIn(10)).not.toThrow();
  });

  it('throws on zero quantity', () => {
    expect(() => validateStockIn(0)).toThrow('greater than 0');
  });

  it('throws on negative quantity', () => {
    expect(() => validateStockIn(-1)).toThrow('greater than 0');
  });
});

describe('validateItemCreate', () => {
  it('passes with unique SKU', () => {
    expect(() => validateItemCreate({ sku: 'NEW-001' }, [makeItem()])).not.toThrow();
  });

  it('throws DuplicateSkuError on duplicate', () => {
    expect(() => validateItemCreate({ sku: 'WDG-001' }, [makeItem()])).toThrow(DuplicateSkuError);
  });
});

describe('validateItemUpdate', () => {
  it('passes with whitelisted fields', () => {
    expect(() => validateItemUpdate({ name: 'New Name', location: 'Bay B' })).not.toThrow();
  });

  it('rejects unknown keys via strict schema', () => {
    expect(() => validateItemUpdate({ quantity: 999 } as never)).toThrow();
  });

  it('rejects createdBy in update data', () => {
    expect(() => validateItemUpdate({ createdBy: 'hacker@evil.com' } as never)).toThrow();
  });
});

describe('validateItemExists', () => {
  it('returns item when found', () => {
    const item = makeItem();
    expect(validateItemExists('item-1', [item])).toBe(item);
  });

  it('throws ItemNotFoundError when missing', () => {
    expect(() => validateItemExists('nonexistent', [makeItem()])).toThrow(ItemNotFoundError);
  });
});
