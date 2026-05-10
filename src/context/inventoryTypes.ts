import type { OrderReceivedLine } from '../models/transaction';

export interface OrderCreateInput {
  poNumber: string;
  orderConfirmationNumber: string;
  supplier: string;
  expectedDeliveryDate?: string | null;
  lineItems: Array<{
    /** Set true if this line should also create a stub item for an unknown SKU */
    quickAdd?: boolean;
    name: string;
    unitOfMeasure: string;
    quantityOrdered: number;
    unitCost: number;
    /** Required when quickAdd is false */
    itemId?: string;
  }>;
  note?: string | null;
  /** Files staged in browser memory; uploaded on commit */
  attachments?: File[];
}

export interface OrderReceiveInput {
  actualReceiveDate: string;
  receivedLines: Array<OrderReceivedLine>;
  attachments?: File[];
}
