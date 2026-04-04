import { z } from 'zod';

// ── Data payload schemas per transaction type ──

export const StockDataSchema = z.object({
  quantity: z.number().int().positive('Quantity must be a positive integer'),
  lotNumber: z.string().optional(),
  expirationDate: z.string().optional(),
  note: z.string().optional(),
}).strict();

export const ItemCreateDataSchema = z.object({
  sku: z.string().min(1, 'SKU is required'),
  name: z.string().min(1, 'Name is required'),
  quantity: z.number().int().nonnegative('Quantity cannot be negative'),
  location: z.string().min(1, 'Location is required'),
  category: z.string().min(1, 'Category is required'),
  supplier: z.string().min(1, 'Supplier is required'),
  unitCost: z.number().nonnegative('Unit cost cannot be negative').optional(),
  reorderPoint: z.number().int().nonnegative('Reorder point cannot be negative'),
  vendor: z.string(),
  referenceNumber: z.string(),
  imageFilename: z.string().optional(),
  note: z.string().optional(),
  lotNumber: z.string().optional(),
  expirationDate: z.string().optional(),
}).strict();

export const ItemUpdateDataSchema = z.object({
  name: z.string().min(1).optional(),
  location: z.string().min(1).optional(),
  category: z.string().min(1).optional(),
  supplier: z.string().min(1).optional(),
  unitCost: z.number().nonnegative().optional(),
  reorderPoint: z.number().int().nonnegative().optional(),
  vendor: z.string().optional(),
  referenceNumber: z.string().optional(),
  imageFilename: z.string().optional(),
  note: z.string().optional(),
}).strict();

export const ItemDeleteDataSchema = z.object({
  note: z.string().optional(),
}).strict();

// ── Transaction schema with discriminated union on type ──

const baseTransaction = {
  id: z.string().uuid('Transaction ID must be a UUID'),
  itemId: z.string().uuid('Item ID must be a UUID'),
  performedBy: z.string().email('performedBy must be an email'),
  timestamp: z.string().datetime({ message: 'timestamp must be ISO 8601' }),
};

const StockInTransaction = z.object({
  ...baseTransaction,
  type: z.literal('stock-in'),
  data: StockDataSchema,
});

const StockOutTransaction = z.object({
  ...baseTransaction,
  type: z.literal('stock-out'),
  data: StockDataSchema,
});

const ItemCreateTransaction = z.object({
  ...baseTransaction,
  type: z.literal('item-create'),
  data: ItemCreateDataSchema,
});

const ItemUpdateTransaction = z.object({
  ...baseTransaction,
  type: z.literal('item-update'),
  data: ItemUpdateDataSchema,
});

const ItemDeleteTransaction = z.object({
  ...baseTransaction,
  type: z.literal('item-delete'),
  data: ItemDeleteDataSchema,
});

export const TransactionSchema = z.discriminatedUnion('type', [
  StockInTransaction,
  StockOutTransaction,
  ItemCreateTransaction,
  ItemUpdateTransaction,
  ItemDeleteTransaction,
]);

export const TransactionLogSchema = z.object({
  transactions: z.array(TransactionSchema),
});

export type ValidatedTransaction = z.infer<typeof TransactionSchema>;
export type ValidatedTransactionLog = z.infer<typeof TransactionLogSchema>;
