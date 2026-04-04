/** A batch of stock received via stock-in, tracked for FEFO expiration */
export interface Batch {
  lotNumber: string;
  expirationDate: string;
  quantity: number;
  receivedAt: string;
}

export interface InventoryItem {
  id: string;
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
  createdBy: string;
  updatedAt: string;
  /** Batches sorted by expiration (earliest first) — drives FEFO consumption */
  batches: Batch[];
  /** Earliest expiration across remaining batches (derived) */
  earliestExpiration: string;
}
