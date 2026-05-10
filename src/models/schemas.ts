import { z } from 'zod';

// ── Data payload schemas per transaction type ──
// Each schema has TWO variants:
//   *Schema           — strict, used by parseTransactionInput on the WRITE path
//   *SchemaTolerant   — passthrough, used by per-element safeParse on the READ path
//
// The strict variant blocks payload-shape regressions (e.g. ItemUpdateData with
// a stray `quantity` field). The tolerant variant lets stale tabs read newer
// payloads without dropping the entire transaction.

export const StockDataSchema = z.object({
  quantity: z.number().int().positive('Quantity must be a positive integer'),
  lotNumber: z.string().optional(),
  expirationDate: z.string().optional(),
  note: z.string().optional(),
  /** Optional traceability link to the originating purchase order (set when stock-in is emitted from an order receive) */
  orderId: z.string().uuid().optional(),
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
  /**
   * Unit of measure (defaults to 'each' when not present in older transactions).
   * Replaying an old item-create with no field gets 'each' injected — safe
   * because creation defines the initial value.
   */
  unitOfMeasure: z.string().min(1).default('each'),
  /**
   * Stub flag: true for items quick-added from an order line that doesn't
   * resolve to existing inventory. Old transactions without the field default
   * to false. Only forward graduation is allowed via item-update.
   */
  isStub: z.boolean().default(false),
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
  /**
   * Optional WITH NO DEFAULT. deriveInventory merges only defined keys into the
   * existing item (see deriveState.ts). A default would inject a value into
   * every replayed update and silently overwrite a previously-set value.
   */
  unitOfMeasure: z.string().min(1).optional(),
  /**
   * Update may ONLY graduate a stub to false; users cannot manually re-stub.
   */
  isStub: z.literal(false).optional(),
}).strict();

export const ItemDeleteDataSchema = z.object({
  note: z.string().optional(),
}).strict();

// ── Order payload schemas ──

export const OrderLineItemSchema = z.object({
  id: z.string().uuid('OrderLineItem id must be a UUID'),
  itemId: z.string().uuid('itemId must be a UUID'),
  name: z.string().min(1, 'Line item name is required'),
  unitOfMeasure: z.string().min(1, 'Unit of measure is required'),
  quantityOrdered: z.number().int().positive('quantityOrdered must be > 0'),
  unitCost: z.number().nonnegative('unitCost must be >= 0'),
}).strict();

export const OrderAttachmentSchema = z.object({
  id: z.string().uuid(),
  stage: z.enum(['placed', 'received']),
  filename: z.string().min(1),
  originalFilename: z.string().min(1),
  contentType: z.string().min(1),
  sizeBytes: z.number().nonnegative(),
  uploadedAt: z.string().datetime(),
  uploadedBy: z.string().email(),
}).strict();

export const OrderCreateDataSchema = z.object({
  poNumber: z.string().trim().regex(
    /^[A-Za-z0-9-]{1,32}$/,
    'PO# must be 1-32 ASCII alphanumerics or dashes',
  ),
  orderConfirmationNumber: z.string().min(1, 'Order confirmation number is required'),
  supplier: z.string().min(1, 'Supplier is required'),
  orderDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'orderDate must be YYYY-MM-DD'),
  expectedDeliveryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  lineItems: z.array(OrderLineItemSchema).min(1, 'At least one line item is required')
    .refine(
      (lines) => new Set(lines.map((l) => l.id)).size === lines.length,
      { message: 'OrderLineItem ids must be unique within an order' },
    ),
  attachments: z.array(OrderAttachmentSchema).default([]),
  note: z.string().nullable().optional(),
}).strict();

export const OrderReceivedLineSchema = z.object({
  id: z.string().uuid('Received line id must be a UUID matching OrderLineItem.id'),
  quantityReceived: z.number().int().nonnegative('quantityReceived must be >= 0'),
  lotNumber: z.string().optional(),
  expirationDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  pastExpirationReason: z.string().optional(),
}).strict().refine(
  (line) => line.quantityReceived === 0 || (line.lotNumber !== undefined && line.lotNumber.length > 0),
  { message: 'lotNumber is required when quantityReceived > 0', path: ['lotNumber'] },
).refine(
  (line) => line.quantityReceived === 0 || (line.expirationDate !== undefined && line.expirationDate.length > 0),
  { message: 'expirationDate is required when quantityReceived > 0', path: ['expirationDate'] },
);

export const OrderReceiveDataSchema = z.object({
  /**
   * Schema-level: format only (replay-stable). The "today − 30 days ≤ x ≤ today"
   * window is enforced by the form's submit handler and validateTransaction —
   * NEVER at the schema layer (would invalidate historical events on re-read).
   */
  actualReceiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'actualReceiveDate must be YYYY-MM-DD'),
  receivedLines: z.array(OrderReceivedLineSchema).min(1, 'receivedLines must not be empty (use cancel for zero-receive)'),
  attachments: z.array(OrderAttachmentSchema).default([]),
}).strict();

export const OrderCancelDataSchema = z.object({
  note: z.string().optional(),
  /**
   * Informational ONLY: the replacement order's pre-rolled UUID for audit
   * purposes. validateTransaction MUST NOT verify that this resolves to an
   * existing order — the staged loop processes the cancel BEFORE the
   * replacement order-create.
   */
  replacedBy: z.string().uuid().optional(),
}).strict();

// Tolerant (read-path) variants: passthrough preserves unknown fields written
// by newer code, so a stale tab can still parse the entry instead of dropping
// the entire transaction.
export const StockDataSchemaTolerant = StockDataSchema.passthrough();
export const ItemCreateDataSchemaTolerant = ItemCreateDataSchema.passthrough();
export const ItemUpdateDataSchemaTolerant = ItemUpdateDataSchema.passthrough();
export const ItemDeleteDataSchemaTolerant = ItemDeleteDataSchema.passthrough();
export const OrderCreateDataSchemaTolerant = OrderCreateDataSchema.passthrough();
export const OrderReceiveDataSchemaTolerant = OrderReceiveDataSchema.passthrough();
export const OrderCancelDataSchemaTolerant = OrderCancelDataSchema.passthrough();

// ── Transaction schema with discriminated union on type ──

const baseTransaction = {
  id: z.string().uuid('Transaction ID must be a UUID'),
  itemId: z.string().uuid('Item ID must be a UUID'),
  performedBy: z.string().email('performedBy must be an email'),
  timestamp: z.string().datetime({ message: 'timestamp must be ISO 8601' }),
};

const buildTxnUnion = (data: {
  stockIn: z.ZodType;
  stockOut: z.ZodType;
  itemCreate: z.ZodType;
  itemUpdate: z.ZodType;
  itemDelete: z.ZodType;
  orderCreate: z.ZodType;
  orderReceive: z.ZodType;
  orderCancel: z.ZodType;
}) => z.discriminatedUnion('type', [
  z.object({ ...baseTransaction, type: z.literal('stock-in'), data: data.stockIn }),
  z.object({ ...baseTransaction, type: z.literal('stock-out'), data: data.stockOut }),
  z.object({ ...baseTransaction, type: z.literal('item-create'), data: data.itemCreate }),
  z.object({ ...baseTransaction, type: z.literal('item-update'), data: data.itemUpdate }),
  z.object({ ...baseTransaction, type: z.literal('item-delete'), data: data.itemDelete }),
  z.object({ ...baseTransaction, type: z.literal('order-create'), data: data.orderCreate }),
  z.object({ ...baseTransaction, type: z.literal('order-receive'), data: data.orderReceive }),
  z.object({ ...baseTransaction, type: z.literal('order-cancel'), data: data.orderCancel }),
]);

/**
 * READ-path discriminated union: tolerant, used by per-element safeParse when
 * loading the log. Unknown fields on the data payload pass through.
 */
export const TransactionReadSchema = buildTxnUnion({
  stockIn: StockDataSchemaTolerant,
  stockOut: StockDataSchemaTolerant,
  itemCreate: ItemCreateDataSchemaTolerant,
  itemUpdate: ItemUpdateDataSchemaTolerant,
  itemDelete: ItemDeleteDataSchemaTolerant,
  orderCreate: OrderCreateDataSchemaTolerant,
  orderReceive: OrderReceiveDataSchemaTolerant,
  orderCancel: OrderCancelDataSchemaTolerant,
});

/**
 * WRITE-path discriminated union: strict, used by parseTransactionInput before
 * a transaction is committed. Catches programmer errors like an extra field
 * on an item-update payload.
 */
export const TransactionWriteSchema = buildTxnUnion({
  stockIn: StockDataSchema,
  stockOut: StockDataSchema,
  itemCreate: ItemCreateDataSchema,
  itemUpdate: ItemUpdateDataSchema,
  itemDelete: ItemDeleteDataSchema,
  orderCreate: OrderCreateDataSchema,
  orderReceive: OrderReceiveDataSchema,
  orderCancel: OrderCancelDataSchema,
});

/**
 * Backwards-compatible alias for older callers / tests.
 * Prefer TransactionReadSchema or TransactionWriteSchema explicitly.
 */
export const TransactionSchema = TransactionWriteSchema;

/**
 * Top-level log shape. The `transactions` array is z.unknown() at this layer:
 * stale-bundle tolerance requires we never reject the WHOLE log when one entry
 * has a future shape. Per-element validation happens in fileOperations using
 * TransactionReadSchema.safeParse().
 */
export const TransactionLogSchema = z.object({
  /**
   * Bundle-recognized schema versions. Current writers always stamp 2. We
   * accept any number on read so a future v3 log can be opened by this
   * bundle without throwing at envelope parse — the per-entry safeParse
   * still skips entries whose shape we don't recognize, and writes are
   * separately blocked when those skipped entries exist.
   */
  schemaVersion: z.number().optional(),
  transactions: z.array(z.unknown()),
});

export type ValidatedTransaction = z.infer<typeof TransactionWriteSchema>;
export type ValidatedTransactionLog = z.infer<typeof TransactionLogSchema>;
