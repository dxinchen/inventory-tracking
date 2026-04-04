import { useState, useCallback, useEffect } from 'react';
import type { Transaction } from '../models/transaction';
import type { InventoryItem } from '../models/inventory';
import { readTransactionLog } from '../api/fileOperations';
import { deriveInventory } from '../utils/deriveState';
import { DataLossError } from '../api/graphClient';

interface UseInventoryDataResult {
  items: InventoryItem[];
  transactions: Transaction[];
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
}

/**
 * Hook that reads transactions.json on mount and derives inventory state.
 * Only called after bootstrap is complete.
 */
export function useInventoryData(): UseInventoryDataResult {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const { data } = await readTransactionLog();
      setTransactions(data.transactions);
      setItems(deriveInventory(data.transactions));
    } catch (err) {
      if (err instanceof Error && err.message.includes('404')) {
        setError(new DataLossError());
      } else {
        setError(err instanceof Error ? err : new Error(String(err)));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { items, transactions, loading, error, refresh };
}
