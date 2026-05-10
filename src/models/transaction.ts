import type { OrderAttachment } from './order';

export type TransactionType =
  | 'item-create' | 'item-update' | 'item-delete'
  | 'stock-in'   | 'stock-out'
  | 'order-create' | 'order-receive' | 'order-cancel';

export interface ItemCreateData {
  sku: string;
  name: string;
  quantity: number;
  location: string;
  category: string;
  supplier: string;
  unitCost?: number;
  reorderPoint: number;
  vendor: string;
  referenceNumber: string;
  imageFilename?: string;
  note?: string;
  /** Optional initial lot info when creating with starting stock */
  lotNumber?: string;
  expirationDate?: string;
  /** Defaulted to 'each' for transactions written before this field existed */
  unitOfMeasure?: string;
  /** Defaulted to false. Quick-add stub items set this true. */
  isStub?: boolean;
}

/** Strict whitelist: only metadata fields, NOT quantity/createdBy/id */
export interface ItemUpdateData {
  name?: string;
  location?: string;
  category?: string;
  supplier?: string;
  unitCost?: number;
  reorderPoint?: number;
  vendor?: string;
  referenceNumber?: string;
  imageFilename?: string;
  note?: string;
  unitOfMeasure?: string;
  /** Forward graduation only — schema rejects setting to true */
  isStub?: false;
}

export interface ItemDeleteData {
  note?: string;
}

export interface StockData {
  quantity: number;
  lotNumber?: string;
  expirationDate?: string;
  note?: string;
  /** Optional traceability link to the originating purchase order (stock-in only, set when emitted from a receive event) */
  orderId?: string;
}

// ── Order data payloads ──

export interface OrderCreateLineItem {
  id: string;
  itemId: string;
  name: string;
  unitOfMeasure: string;
  quantityOrdered: number;
  unitCost: number;
}

export interface OrderCreateData {
  poNumber: string;
  orderConfirmationNumber: string;
  supplier: string;
  /** YYYY-MM-DD */
  orderDate: string;
  expectedDeliveryDate?: string | null;
  lineItems: OrderCreateLineItem[];
  attachments?: OrderAttachment[];
  note?: string | null;
}

export interface OrderReceivedLine {
  id: string;
  quantityReceived: number;
  lotNumber?: string;
  expirationDate?: string;
  pastExpirationReason?: string;
}

export interface OrderReceiveData {
  /** YYYY-MM-DD */
  actualReceiveDate: string;
  receivedLines: OrderReceivedLine[];
  attachments?: OrderAttachment[];
}

export interface OrderCancelData {
  note?: string;
  /** Informational only — the replacement order's pre-rolled UUID for audit. NOT validated against existence. */
  replacedBy?: string;
}

export type TransactionData =
  | ItemCreateData
  | ItemUpdateData
  | ItemDeleteData
  | StockData
  | OrderCreateData
  | OrderReceiveData
  | OrderCancelData;

/**
 * Full transaction as stored in transactions.json — includes audit fields.
 *
 * For order-* events, `itemId` is reinterpreted as the ORDER's UUID (not an
 * item's). Both id spaces are crypto.randomUUID() so collision is astronomically
 * unlikely; the defensive-ignore branch in deriveOrders/deriveInventory guards
 * against the pathological case.
 */
export interface Transaction {
  id: string;
  type: TransactionType;
  itemId: string;
  data: TransactionData;
  performedBy: string;
  timestamp: string;
}

/** What callers pass to appendTransaction(s) — no audit fields */
export interface TransactionInput {
  id: string;
  type: TransactionType;
  itemId: string;
  data: TransactionData;
}

export interface TransactionLog {
  /** Marker set by writers; readers ignore unknown values. */
  schemaVersion?: 2;
  transactions: Transaction[];
}
