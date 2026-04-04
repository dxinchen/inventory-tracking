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
