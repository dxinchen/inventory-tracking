import { describe, it, expect } from 'vitest';
import {
  TransactionLogSchema,
  TransactionReadSchema,
  TransactionWriteSchema,
  StockDataSchema,
  ItemCreateDataSchema,
  ItemUpdateDataSchema,
  OrderCreateDataSchema,
  OrderReceiveDataSchema,
  OrderCancelDataSchema,
} from '../schemas';

const validUuid = () => crypto.randomUUID();

describe('StockDataSchema', () => {
  it('accepts valid stock data', () => {
    expect(() => StockDataSchema.parse({ quantity: 10 })).not.toThrow();
    expect(() => StockDataSchema.parse({ quantity: 1, note: 'test' })).not.toThrow();
  });

  it('accepts optional orderId for traceability', () => {
    expect(() => StockDataSchema.parse({ quantity: 1, orderId: validUuid() })).not.toThrow();
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

  it('defaults unitOfMeasure to "each" when omitted', () => {
    const parsed = ItemCreateDataSchema.parse(valid);
    expect(parsed.unitOfMeasure).toBe('each');
  });

  it('defaults isStub to false when omitted', () => {
    const parsed = ItemCreateDataSchema.parse(valid);
    expect(parsed.isStub).toBe(false);
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

describe('ItemUpdateDataSchema (write-path strict)', () => {
  it('rejects unknown extra keys (whitelist preserved)', () => {
    // Documented at validation.ts: this prevents a buggy updateItem from
    // injecting quantity. Read-path uses passthrough, write-path stays strict.
    expect(() => ItemUpdateDataSchema.parse({ name: 'x', quantity: 999 })).toThrow();
  });

  it('rejects setting isStub to true (only graduation allowed)', () => {
    expect(() => ItemUpdateDataSchema.parse({ isStub: true })).toThrow();
  });

  it('accepts isStub: false (graduation)', () => {
    expect(() => ItemUpdateDataSchema.parse({ isStub: false })).not.toThrow();
  });

  it('does NOT inject unitOfMeasure default on update', () => {
    // Critical: deriveInventory merges defined keys only. If update injected
    // a default it would silently overwrite a previously-set value on replay.
    const parsed = ItemUpdateDataSchema.parse({ name: 'x' });
    expect(parsed.unitOfMeasure).toBeUndefined();
  });
});

describe('TransactionLogSchema (top level)', () => {
  it('accepts empty transactions array', () => {
    expect(() => TransactionLogSchema.parse({ transactions: [] })).not.toThrow();
  });

  it('accepts unknown entries — per-entry validation happens elsewhere', () => {
    // Top level is z.unknown() so a stale tab can read newer entries without
    // crashing. Entry validation is per-element via TransactionReadSchema.
    expect(() => TransactionLogSchema.parse({
      transactions: [{ totally: 'unknown shape' }],
    })).not.toThrow();
  });

  it('accepts schemaVersion: 2 marker', () => {
    expect(() => TransactionLogSchema.parse({ schemaVersion: 2, transactions: [] })).not.toThrow();
  });
});

describe('TransactionReadSchema (per-entry, tolerant)', () => {
  it('accepts a valid stock-in transaction', () => {
    const tx = {
      id: validUuid(),
      type: 'stock-in',
      itemId: validUuid(),
      data: { quantity: 10 },
      performedBy: 'user@company.com',
      timestamp: '2026-04-03T10:00:00Z',
    };
    expect(() => TransactionReadSchema.parse(tx)).not.toThrow();
  });

  it('passes unknown extra fields on the data payload through (does not drop transaction)', () => {
    const tx = {
      id: validUuid(),
      type: 'item-update',
      itemId: validUuid(),
      data: { name: 'X', futureField: 'whatever' },
      performedBy: 'user@company.com',
      timestamp: '2026-04-03T10:00:00Z',
    };
    expect(() => TransactionReadSchema.parse(tx)).not.toThrow();
  });
});

describe('TransactionWriteSchema (per-entry, strict)', () => {
  it('rejects stock-out with missing quantity', () => {
    const tx = {
      id: validUuid(),
      type: 'stock-out',
      itemId: validUuid(),
      data: {},
      performedBy: 'user@company.com',
      timestamp: '2026-04-03T10:00:00Z',
    };
    expect(() => TransactionWriteSchema.parse(tx)).toThrow();
  });

  it('rejects item-create without sku', () => {
    const tx = {
      id: validUuid(),
      type: 'item-create',
      itemId: validUuid(),
      data: { name: 'Widget', quantity: 10, location: 'A', category: 'B', supplier: 'C', unitCost: 1, reorderPoint: 0, vendor: '', referenceNumber: '' },
      performedBy: 'user@company.com',
      timestamp: '2026-04-03T10:00:00Z',
    };
    expect(() => TransactionWriteSchema.parse(tx)).toThrow();
  });

  it('rejects wrong type in quantity field', () => {
    const tx = {
      id: validUuid(),
      type: 'stock-in',
      itemId: validUuid(),
      data: { quantity: 'ten' },
      performedBy: 'user@company.com',
      timestamp: '2026-04-03T10:00:00Z',
    };
    expect(() => TransactionWriteSchema.parse(tx)).toThrow();
  });

  it('rejects stock-in with negative quantity', () => {
    const tx = {
      id: validUuid(),
      type: 'stock-in',
      itemId: validUuid(),
      data: { quantity: -5 },
      performedBy: 'user@company.com',
      timestamp: '2026-04-03T10:00:00Z',
    };
    expect(() => TransactionWriteSchema.parse(tx)).toThrow();
  });
});

describe('OrderCreateDataSchema', () => {
  const baseLine = {
    id: validUuid(), itemId: validUuid(), name: 'PCR Tubes',
    unitOfMeasure: 'each', quantityOrdered: 10, unitCost: 1.5,
  };
  const validOrder = {
    poNumber: 'PO-2026-0001',
    orderConfirmationNumber: 'CONF-1',
    supplier: 'Qiagen',
    orderDate: '2026-05-09',
    lineItems: [baseLine],
  };

  it('accepts valid order data', () => {
    expect(() => OrderCreateDataSchema.parse(validOrder)).not.toThrow();
  });

  it('rejects PO# with whitespace, emoji, or non-ASCII', () => {
    expect(() => OrderCreateDataSchema.parse({ ...validOrder, poNumber: 'PO 123' })).toThrow();
    expect(() => OrderCreateDataSchema.parse({ ...validOrder, poNumber: 'PO-😀' })).toThrow();
    // Cyrillic О vs Latin O — confusable
    expect(() => OrderCreateDataSchema.parse({ ...validOrder, poNumber: 'POН' })).toThrow();
  });

  it('rejects empty line items array', () => {
    expect(() => OrderCreateDataSchema.parse({ ...validOrder, lineItems: [] })).toThrow();
  });

  it('rejects duplicate line item ids', () => {
    expect(() => OrderCreateDataSchema.parse({
      ...validOrder,
      lineItems: [baseLine, baseLine],
    })).toThrow(/unique/i);
  });

  it('rejects line with zero or negative quantityOrdered', () => {
    expect(() => OrderCreateDataSchema.parse({
      ...validOrder,
      lineItems: [{ ...baseLine, id: validUuid(), quantityOrdered: 0 }],
    })).toThrow();
  });
});

describe('OrderReceiveDataSchema', () => {
  const validReceive = {
    actualReceiveDate: '2026-05-09',
    receivedLines: [{
      id: validUuid(), quantityReceived: 5, lotNumber: 'LOT-A', expirationDate: '2027-01-01',
    }],
  };

  it('accepts valid receive data', () => {
    expect(() => OrderReceiveDataSchema.parse(validReceive)).not.toThrow();
  });

  it('accepts zero-receive line without lot/exp', () => {
    expect(() => OrderReceiveDataSchema.parse({
      ...validReceive,
      receivedLines: [{ id: validUuid(), quantityReceived: 0 }],
    })).not.toThrow();
  });

  it('rejects empty receivedLines (use cancel for receive nothing)', () => {
    expect(() => OrderReceiveDataSchema.parse({
      ...validReceive,
      receivedLines: [],
    })).toThrow();
  });

  it('requires lotNumber when quantityReceived > 0', () => {
    expect(() => OrderReceiveDataSchema.parse({
      ...validReceive,
      receivedLines: [{ id: validUuid(), quantityReceived: 5, expirationDate: '2027-01-01' }],
    })).toThrow();
  });

  it('requires expirationDate when quantityReceived > 0', () => {
    expect(() => OrderReceiveDataSchema.parse({
      ...validReceive,
      receivedLines: [{ id: validUuid(), quantityReceived: 5, lotNumber: 'X' }],
    })).toThrow();
  });

  it('rejects malformed actualReceiveDate', () => {
    expect(() => OrderReceiveDataSchema.parse({
      ...validReceive,
      actualReceiveDate: '2026/05/09',
    })).toThrow();
  });
});

describe('OrderCancelDataSchema', () => {
  it('accepts empty data', () => {
    expect(() => OrderCancelDataSchema.parse({})).not.toThrow();
  });

  it('accepts a note and replacedBy uuid', () => {
    expect(() => OrderCancelDataSchema.parse({
      note: 'Replaced by PO-2026-0002',
      replacedBy: validUuid(),
    })).not.toThrow();
  });

  it('does NOT reject replacedBy referencing an absent order id (informational only)', () => {
    // Schema is informational; existence check intentionally omitted to keep
    // the cancel-and-recreate batch ordering simple (cancel before create).
    expect(() => OrderCancelDataSchema.parse({ replacedBy: validUuid() })).not.toThrow();
  });
});
