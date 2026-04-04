import { describe, it, expect } from 'vitest';
import { TransactionLogSchema, StockDataSchema, ItemCreateDataSchema } from '../schemas';

describe('StockDataSchema', () => {
  it('accepts valid stock data', () => {
    expect(() => StockDataSchema.parse({ quantity: 10 })).not.toThrow();
    expect(() => StockDataSchema.parse({ quantity: 1, note: 'test' })).not.toThrow();
  });

  it('rejects zero quantity', () => {
    expect(() => StockDataSchema.parse({ quantity: 0 })).toThrow();
  });

  it('rejects negative quantity', () => {
    expect(() => StockDataSchema.parse({ quantity: -5 })).toThrow();
  });

  it('rejects missing quantity', () => {
    expect(() => StockDataSchema.parse({ note: 'test' })).toThrow();
  });
});

describe('ItemCreateDataSchema', () => {
  const valid = {
    sku: 'WDG-001', name: 'Widget', quantity: 10, location: 'Bay A',
    category: 'Widgets', supplier: 'Acme', unitCost: 4.99,
    reorderPoint: 5, vendor: 'Acme Corp', referenceNumber: 'PO-001',
  };

  it('accepts valid item data', () => {
    expect(() => ItemCreateDataSchema.parse(valid)).not.toThrow();
  });

  it('rejects missing sku', () => {
    expect(() => ItemCreateDataSchema.parse({ ...valid, sku: '' })).toThrow();
  });

  it('rejects missing name', () => {
    expect(() => ItemCreateDataSchema.parse({ ...valid, name: '' })).toThrow();
  });

  it('accepts zero quantity', () => {
    expect(() => ItemCreateDataSchema.parse({ ...valid, quantity: 0 })).not.toThrow();
  });

  it('rejects negative quantity', () => {
    expect(() => ItemCreateDataSchema.parse({ ...valid, quantity: -1 })).toThrow();
  });
});

describe('TransactionLogSchema', () => {
  it('accepts empty transactions array', () => {
    expect(() => TransactionLogSchema.parse({ transactions: [] })).not.toThrow();
  });

  it('accepts valid stock-in transaction', () => {
    const log = {
      transactions: [{
        id: '550e8400-e29b-41d4-a716-446655440000',
        type: 'stock-in',
        itemId: '550e8400-e29b-41d4-a716-446655440001',
        data: { quantity: 10 },
        performedBy: 'user@company.com',
        timestamp: '2026-04-03T10:00:00Z',
      }],
    };
    expect(() => TransactionLogSchema.parse(log)).not.toThrow();
  });

  it('rejects stock-out with missing quantity', () => {
    const log = {
      transactions: [{
        id: '550e8400-e29b-41d4-a716-446655440000',
        type: 'stock-out',
        itemId: '550e8400-e29b-41d4-a716-446655440001',
        data: {},
        performedBy: 'user@company.com',
        timestamp: '2026-04-03T10:00:00Z',
      }],
    };
    expect(() => TransactionLogSchema.parse(log)).toThrow();
  });

  it('rejects item-create without sku', () => {
    const log = {
      transactions: [{
        id: '550e8400-e29b-41d4-a716-446655440000',
        type: 'item-create',
        itemId: '550e8400-e29b-41d4-a716-446655440001',
        data: { name: 'Widget', quantity: 10, location: 'A', category: 'B', supplier: 'C', unitCost: 1, reorderPoint: 0, vendor: '', referenceNumber: '' },
        performedBy: 'user@company.com',
        timestamp: '2026-04-03T10:00:00Z',
      }],
    };
    expect(() => TransactionLogSchema.parse(log)).toThrow();
  });

  it('rejects wrong type in quantity field', () => {
    const log = {
      transactions: [{
        id: '550e8400-e29b-41d4-a716-446655440000',
        type: 'stock-in',
        itemId: '550e8400-e29b-41d4-a716-446655440001',
        data: { quantity: 'ten' },
        performedBy: 'user@company.com',
        timestamp: '2026-04-03T10:00:00Z',
      }],
    };
    expect(() => TransactionLogSchema.parse(log)).toThrow();
  });

  it('rejects stock-in with negative quantity', () => {
    const log = {
      transactions: [{
        id: '550e8400-e29b-41d4-a716-446655440000',
        type: 'stock-in',
        itemId: '550e8400-e29b-41d4-a716-446655440001',
        data: { quantity: -5 },
        performedBy: 'user@company.com',
        timestamp: '2026-04-03T10:00:00Z',
      }],
    };
    expect(() => TransactionLogSchema.parse(log)).toThrow();
  });
});
