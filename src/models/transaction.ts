export type TransactionType = 'item-create' | 'item-update' | 'item-delete' | 'stock-in' | 'stock-out';

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
}

export interface ItemDeleteData {
  note?: string;
}

export interface StockData {
  quantity: number;
  lotNumber?: string;
  expirationDate?: string;
  note?: string;
}

export type TransactionData = ItemCreateData | ItemUpdateData | ItemDeleteData | StockData;

/** Full transaction as stored in transactions.json — includes audit fields */
export interface Transaction {
  id: string;
  type: TransactionType;
  itemId: string;
  data: TransactionData;
  performedBy: string;
  timestamp: string;
}

/** What callers pass to appendTransaction() — no audit fields */
export interface TransactionInput {
  id: string;
  type: TransactionType;
  itemId: string;
  data: TransactionData;
}

export interface TransactionLog {
  transactions: Transaction[];
}
