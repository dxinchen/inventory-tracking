/**
 * Order is derived state — there is no orders.json. The current set of orders
 * is rebuilt by replaying order-* transactions from transactions.json (see
 * deriveState.ts). All persistence happens via the standard transaction log.
 */

export type OrderStatus = 'placed' | 'received' | 'cancelled';

export const ORDER_STATUS_DISPLAY: Record<OrderStatus, { badge: string; label: string }> = {
  placed: { badge: 'low', label: 'Placed' },
  received: { badge: 'ok', label: 'Received' },
  cancelled: { badge: 'critical', label: 'Cancelled' },
};

export interface OrderLineItem {
  /** Stable across the order's lifecycle. The receive form maps received line ids against these. */
  id: string;
  /** Links to InventoryItem.id. May not resolve if the underlying item was deleted (received-order edge case). */
  itemId: string;
  /** Snapshot at order time — historical record. Detail page uses these, never current item fields. */
  name: string;
  unitOfMeasure: string;
  quantityOrdered: number;
  /**
   * null iff order status is 'placed' or 'cancelled'.
   * explicit number (including 0) iff status is 'received'.
   */
  quantityReceived: number | null;
  unitCost: number;
  /** Required iff quantityReceived > 0 */
  lotNumber: string | null;
  /** Required iff quantityReceived > 0 (YYYY-MM-DD) */
  expirationDate: string | null;
  /** Optional reason recorded when receiving lots that expire before today */
  pastExpirationReason?: string;
}

export interface OrderAttachment {
  id: string;
  stage: 'placed' | 'received';
  /** UUID-prefixed sanitized name as stored on SharePoint */
  filename: string;
  /** Original filename as uploaded */
  originalFilename: string;
  contentType: string;
  sizeBytes: number;
  uploadedAt: string;
  uploadedBy: string;
}

export interface Order {
  /** Matches the itemId of the originating order-create transaction. UUID. */
  id: string;
  /** Manual entry, unique across non-cancelled orders */
  poNumber: string;
  orderConfirmationNumber: string;
  supplier: string;
  /** ISO date YYYY-MM-DD */
  orderDate: string;
  expectedDeliveryDate: string | null;
  /** Set on order-receive */
  actualReceiveDate: string | null;
  status: OrderStatus;
  lineItems: OrderLineItem[];
  /** Tagged by stage. No de-duplication: same physical file at both stages shows as two entries. */
  attachments: OrderAttachment[];
  createdBy: string;
  /** Latest order-* event timestamp */
  updatedAt: string;
  note: string | null;
}
