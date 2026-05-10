import type { InventoryItem } from '../models/inventory';
import type { ItemUpdateData } from '../models/transaction';
import { ItemUpdateDataSchema } from '../models/schemas';

export class InsufficientStockError extends Error {
  constructor(itemName: string, requested: number, available: number) {
    super(`Insufficient stock for "${itemName}": requested ${requested}, available ${available}`);
    this.name = 'InsufficientStockError';
  }
}

export class ItemNotFoundError extends Error {
  constructor(itemId: string) {
    super(`Item not found: ${itemId}`);
    this.name = 'ItemNotFoundError';
  }
}

export class DuplicateSkuError extends Error {
  constructor(sku: string) {
    super(`An item with SKU "${sku}" already exists`);
    this.name = 'DuplicateSkuError';
  }
}

export class ItemReferencedByOrderError extends Error {
  constructor(itemId: string, poNumber: string) {
    super(`Cannot delete item ${itemId}: referenced by placed PO ${poNumber}. Cancel the PO first.`);
    this.name = 'ItemReferencedByOrderError';
  }
}

export class PoNumberInUseError extends Error {
  constructor(poNumber: string) {
    super(`PO number "${poNumber}" is already in use by an active order`);
    this.name = 'PoNumberInUseError';
  }
}

export class OrderNotFoundError extends Error {
  constructor(orderId: string) {
    super(`Order not found: ${orderId}`);
    this.name = 'OrderNotFoundError';
  }
}

export class OrderNotPlacedError extends Error {
  constructor(poNumber: string, currentStatus: string) {
    super(`PO ${poNumber} is ${currentStatus}, not placed — action not allowed`);
    this.name = 'OrderNotPlacedError';
  }
}

export class ReceiveCoverageError extends Error {
  constructor(poNumber: string) {
    super(`Receive payload for PO ${poNumber} must cover exactly the order's line items (1:1)`);
    this.name = 'ReceiveCoverageError';
  }
}

export class EmptyReceiveError extends Error {
  constructor(poNumber: string) {
    super(`Receive payload for PO ${poNumber} has no line with quantity > 0 — use Cancel to close an order without receiving stock`);
    this.name = 'EmptyReceiveError';
  }
}

export class ReceiveStockInBindingError extends Error {
  constructor(poNumber: string, detail: string) {
    super(`Receive batch for PO ${poNumber} is malformed: ${detail}`);
    this.name = 'ReceiveStockInBindingError';
  }
}

export function validateStockOut(item: InventoryItem, quantity: number): void {
  if (quantity <= 0) {
    throw new Error('Quantity must be greater than 0');
  }
  if (quantity > item.quantity) {
    throw new InsufficientStockError(item.name, quantity, item.quantity);
  }
}

export function validateStockIn(quantity: number): void {
  if (quantity <= 0) {
    throw new Error('Quantity must be greater than 0');
  }
}

export function validateItemCreate(
  data: { sku: string },
  existingItems: InventoryItem[],
): void {
  if (existingItems.some((item) => item.sku === data.sku)) {
    throw new DuplicateSkuError(data.sku);
  }
}

export function validateItemUpdate(data: ItemUpdateData): void {
  // Enforce strict whitelist via Zod — rejects unknown keys like quantity, createdBy, id
  ItemUpdateDataSchema.parse(data);
}

export function validateItemExists(
  itemId: string,
  items: InventoryItem[],
): InventoryItem {
  const item = items.find((i) => i.id === itemId);
  if (!item) {
    throw new ItemNotFoundError(itemId);
  }
  return item;
}
