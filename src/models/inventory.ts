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
  /** Unit of measure (e.g. 'each', 'box', 'kit', 'case'). Defaults to 'each' for items created before this field existed. */
  unitOfMeasure: string;
  /**
   * Stub flag: true for items quick-added from an order line. Stub items
   * are filtered out of the default inventory list and low-stock alerts.
   * Graduates to false once any stock-in arrives or an explicit update
   * sets isStub: false. Graduation is monotonic — never flips back to true.
   */
  isStub: boolean;
  /** Batches sorted by expiration (earliest first) — drives FEFO consumption */
  batches: Batch[];
  /** Earliest expiration across remaining batches (derived) */
  earliestExpiration: string;
}
