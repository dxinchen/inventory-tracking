import { createContext, useContext, useState, useCallback, useMemo, type ReactNode } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { mockItems, mockTransactions } from '../mock/data';
import type { InventoryItem, Batch } from '../models/inventory';
import type { Transaction, ItemCreateData, ItemUpdateData, StockData } from '../models/transaction';
import { isAdmin } from '../auth/permissions';

/** Set by InventoryProvider from the authenticated user's email */
let currentUserEmail = 'd.chen@biolabs.com';

interface InventoryContextValue {
  items: InventoryItem[];
  transactions: Transaction[];
  isAdmin: boolean;
  addItem: (data: Omit<ItemCreateData, 'quantity'> & { quantity?: number }) => InventoryItem;
  updateItem: (itemId: string, data: ItemUpdateData) => void;
  deleteItem: (itemId: string, note?: string) => void;
  stockIn: (itemId: string, quantity: number, opts?: { lotNumber?: string; expirationDate?: string; note?: string }) => void;
  stockOut: (itemId: string, quantity: number, note?: string) => void;
}

const InventoryContext = createContext<InventoryContextValue | null>(null);

export function useInventory() {
  const ctx = useContext(InventoryContext);
  if (!ctx) throw new Error('useInventory must be used within InventoryProvider');
  return ctx;
}

function buildTransaction(
  type: Transaction['type'],
  itemId: string,
  data: Transaction['data'],
): Transaction {
  return {
    id: uuidv4(),
    type,
    itemId,
    data,
    performedBy: currentUserEmail,
    timestamp: new Date().toISOString(),
  };
}

export function InventoryProvider({ children, userEmail }: { children: ReactNode; userEmail?: string }) {
  if (userEmail) currentUserEmail = userEmail;
  const adminFlag = useMemo(() => isAdmin(currentUserEmail), []);
  const [transactions, setTransactions] = useState<Transaction[]>(mockTransactions as Transaction[]);
  // Initialize items from mock data directly (already pre-derived with batches)
  const [items, setItems] = useState<InventoryItem[]>(mockItems as InventoryItem[]);

  const appendTx = useCallback((tx: Transaction) => {
    setTransactions(prev => {
      const next = [...prev, tx];
      // Re-derive after adding to keep items in sync
      // For live usage we derive from the full log, but since mock items
      // aren't built from mock transactions, we handle mutations directly
      return next;
    });
  }, []);

  const addItem = useCallback((data: Omit<ItemCreateData, 'quantity'> & { quantity?: number }): InventoryItem => {
    const itemId = uuidv4();
    const qty = data.quantity ?? 0;
    const tx = buildTransaction('item-create', itemId, { ...data, quantity: qty } as ItemCreateData);
    appendTx(tx);

    const batches: Batch[] = [];
    if (qty > 0) {
      batches.push({
        lotNumber: (data as ItemCreateData & { lotNumber?: string }).lotNumber || 'INIT',
        expirationDate: (data as ItemCreateData & { expirationDate?: string }).expirationDate || '',
        quantity: qty,
        receivedAt: tx.timestamp,
      });
    }

    const newItem: InventoryItem = {
      id: itemId,
      sku: data.sku,
      name: data.name,
      quantity: qty,
      location: data.location,
      category: data.category,
      supplier: data.supplier,
      unitCost: data.unitCost ?? undefined,
      reorderPoint: data.reorderPoint,
      vendor: data.vendor,
      referenceNumber: data.referenceNumber,
      imageFilename: data.imageFilename,
      createdBy: tx.performedBy,
      updatedAt: tx.timestamp,
      batches,
      earliestExpiration: batches[0]?.expirationDate || '',
    };

    setItems(prev => [...prev, newItem]);
    return newItem;
  }, [appendTx]);

  const updateItem = useCallback((itemId: string, data: ItemUpdateData) => {
    const tx = buildTransaction('item-update', itemId, data);
    appendTx(tx);

    setItems(prev => prev.map(item => {
      if (item.id !== itemId) return item;
      return {
        ...item,
        ...Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined)),
        updatedAt: tx.timestamp,
      };
    }));
  }, [appendTx]);

  const deleteItem = useCallback((itemId: string, note?: string) => {
    const tx = buildTransaction('item-delete', itemId, { note });
    appendTx(tx);
    setItems(prev => prev.filter(item => item.id !== itemId));
  }, [appendTx]);

  const stockIn = useCallback((
    itemId: string,
    quantity: number,
    opts?: { lotNumber?: string; expirationDate?: string; note?: string },
  ) => {
    const stockData: StockData = {
      quantity,
      lotNumber: opts?.lotNumber,
      expirationDate: opts?.expirationDate,
      note: opts?.note,
    };
    const tx = buildTransaction('stock-in', itemId, stockData);
    appendTx(tx);

    setItems(prev => prev.map(item => {
      if (item.id !== itemId) return item;
      const newBatch: Batch = {
        lotNumber: opts?.lotNumber || `LOT-${tx.id.slice(0, 8)}`,
        expirationDate: opts?.expirationDate || '',
        quantity,
        receivedAt: tx.timestamp,
      };
      const batches = [...item.batches, newBatch].sort((a, b) => {
        if (!a.expirationDate && !b.expirationDate) return 0;
        if (!a.expirationDate) return 1;
        if (!b.expirationDate) return -1;
        return a.expirationDate.localeCompare(b.expirationDate);
      });
      const earliest = batches.find(b => b.quantity > 0 && b.expirationDate)?.expirationDate || '';
      return { ...item, quantity: item.quantity + quantity, batches, earliestExpiration: earliest, updatedAt: tx.timestamp };
    }));
  }, [appendTx]);

  const stockOut = useCallback((itemId: string, quantity: number, note?: string) => {
    const tx = buildTransaction('stock-out', itemId, { quantity, note } as StockData);
    appendTx(tx);

    setItems(prev => prev.map(item => {
      if (item.id !== itemId) return item;
      // FEFO consumption
      const sorted = [...item.batches].sort((a, b) => {
        if (!a.expirationDate && !b.expirationDate) return 0;
        if (!a.expirationDate) return 1;
        if (!b.expirationDate) return -1;
        return a.expirationDate.localeCompare(b.expirationDate);
      });
      let remaining = quantity;
      const batches = sorted.map(batch => {
        if (remaining <= 0 || batch.quantity <= 0) return batch;
        const take = Math.min(batch.quantity, remaining);
        remaining -= take;
        return { ...batch, quantity: batch.quantity - take };
      }).filter(b => b.quantity > 0);
      const earliest = batches.find(b => b.quantity > 0 && b.expirationDate)?.expirationDate || '';
      return { ...item, quantity: item.quantity - quantity, batches, earliestExpiration: earliest, updatedAt: tx.timestamp };
    }));
  }, [appendTx]);

  return (
    <InventoryContext.Provider value={{ items, transactions, isAdmin: adminFlag, addItem, updateItem, deleteItem, stockIn, stockOut }}>
      {children}
    </InventoryContext.Provider>
  );
}
