import { createContext, useContext, useState, useEffect, useMemo, useCallback, useRef, type ReactNode } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { mockItems, mockTransactions, mockOrders } from '../mock/data';
import type { InventoryItem } from '../models/inventory';
import type { Order, OrderAttachment, OrderLineItem } from '../models/order';
import type {
  Transaction,
  TransactionInput,
  ItemCreateData,
  ItemUpdateData,
  StockData,
  OrderCreateData,
  OrderReceiveData,
  OrderCancelData,
  OrderCreateLineItem,
} from '../models/transaction';
import { isAdmin } from '../auth/permissions';
import { msalConfigured } from '../auth/msalConfig';
import { initializeDataStore } from '../api/bootstrap';
import { appendTransactions, WriteIndeterminateError, BatchPartiallyCommittedError } from '../api/transactionService';
import { applyToInventoryMap, applyToOrdersMap } from '../utils/deriveState';
import { ensureOrderFolder, uploadOrderAttachment, deleteOrderAttachment } from '../api/attachmentService';
import { todayISO } from '../utils/dates';
import type { OrderCreateInput, OrderReceiveInput } from './inventoryTypes';

const DEFAULT_USER_EMAIL = 'd.chen@biolabs.com';

interface InventoryContextValue {
  items: InventoryItem[];
  orders: Order[];
  transactions: Transaction[];
  isAdmin: boolean;
  loading: boolean;
  error: Error | null;

  addItem: (data: Omit<ItemCreateData, 'quantity'> & { quantity?: number }) => Promise<InventoryItem>;
  updateItem: (itemId: string, data: ItemUpdateData) => Promise<void>;
  deleteItem: (itemId: string, note?: string) => Promise<void>;
  stockIn: (itemId: string, quantity: number, opts?: { lotNumber?: string; expirationDate?: string; note?: string; orderId?: string }) => Promise<void>;
  stockOut: (itemId: string, quantity: number, note?: string) => Promise<void>;

  createOrder: (input: OrderCreateInput) => Promise<Order>;
  receiveOrder: (orderId: string, input: OrderReceiveInput) => Promise<Order>;
  cancelOrder: (orderId: string, note?: string) => Promise<Order>;
  cancelAndRecreate: (predecessorId: string, input: OrderCreateInput) => Promise<Order>;
  findLatestLineItemForItem: (itemId: string) => OrderLineItem | null;
}

const InventoryContext = createContext<InventoryContextValue | null>(null);

// Hook intentionally co-located with the provider; HMR cost is acceptable.
// eslint-disable-next-line react-refresh/only-export-components
export function useInventory() {
  const ctx = useContext(InventoryContext);
  if (!ctx) throw new Error('useInventory must be used within InventoryProvider');
  return ctx;
}

function findOrThrow<T extends { id: string }>(arr: T[], id: string, label: string): T {
  const found = arr.find((x) => x.id === id);
  if (!found) throw new Error(`${label}: ${id} not present in committed state`);
  return found;
}

function rollStubSku(): string {
  // 24-bit random rendered as 6 hex: SKU-XXXXXX
  const n = Math.floor(Math.random() * 0xFFFFFF);
  return `SKU-${n.toString(16).padStart(6, '0').toUpperCase()}`;
}

export function InventoryProvider({ children, userEmail }: { children: ReactNode; userEmail?: string }) {
  const email = userEmail ?? DEFAULT_USER_EMAIL;
  const adminFlag = useMemo(() => isAdmin(email), [email]);
  const emailRef = useRef(email);
  emailRef.current = email;

  const [transactions, setTransactionsRaw] = useState<unknown[]>([]);
  const [known, setKnown] = useState<Transaction[]>([]);
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState<boolean>(msalConfigured);
  const [error, setError] = useState<Error | null>(null);

  // Refs hold the latest state so commit can stay reference-stable. Using
  // state directly in commit's deps would re-allocate the callback (and every
  // callback that depends on it) after every successful write — defeating
  // the provider-value memoization and forcing every consumer to re-render.
  const itemsRef = useRef(items);
  const ordersRef = useRef(orders);
  const knownRef = useRef(known);
  const txRef = useRef(transactions);
  itemsRef.current = items;
  ordersRef.current = orders;
  knownRef.current = known;
  txRef.current = transactions;

  // Bumped on every successful commit. The bootstrap effect samples this
  // before its read and discards the result if it advanced during the read —
  // a write that landed mid-bootstrap reflects newer state, and replacing it
  // with the older snapshot would silently roll back the user's change.
  const writeCounterRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!msalConfigured) {
        setKnown(mockTransactions as unknown as Transaction[]);
        setTransactionsRaw(mockTransactions as unknown as unknown[]);
        setItems(mockItems as unknown as InventoryItem[]);
        setOrders(mockOrders);
        setLoading(false);
        return;
      }
      try {
        setLoading(true);
        setError(null);
        const startCounter = writeCounterRef.current;
        // initializeDataStore returns the freshly-read log so we don't fetch twice.
        const result = await initializeDataStore();
        if (cancelled) return;
        if (writeCounterRef.current !== startCounter) {
          // A commit completed while bootstrap was in flight — its post-write
          // state is already in the React tree. Drop our (now stale) snapshot.
          console.warn('[InventoryProvider] bootstrap superseded by in-flight commit, discarding stale snapshot');
          return;
        }
        // Fail closed on a partially-readable log: writes are already blocked
        // by LogContainsUnreadableEntriesError, but rendering derived state
        // from `known` alone would silently understate quantities or hide
        // received POs. Show the user a clear error instead of authoritative-
        // looking partial state.
        const skipped = result.data.transactions.length - result.known.length;
        if (skipped > 0) {
          throw new Error(
            `transactions.json contains ${skipped} unreadable entr${skipped === 1 ? 'y' : 'ies'} — ` +
            `the displayed inventory and orders would be incomplete. Reload the page; if the problem ` +
            `persists, the file may be corrupted or written by a newer version of the app.`,
          );
        }
        const itemsMap = new Map<string, InventoryItem>();
        const ordersMap = new Map<string, Order>();
        applyToInventoryMap(itemsMap, result.known);
        applyToOrdersMap(ordersMap, result.known);
        setTransactionsRaw(result.data.transactions);
        setKnown(result.known);
        setItems(Array.from(itemsMap.values()));
        setOrders(Array.from(ordersMap.values()));
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err : new Error(String(err)));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  const commit = useCallback(async (inputs: TransactionInput[]) => {
    if (!msalConfigured) {
      // Mock mode: apply staged inputs to seed items/orders via the same
      // helpers SharePoint mode uses. Mock seeds aren't replayed from
      // mockTransactions so we layer changes onto current state.
      const stamped: Transaction[] = inputs.map((i) => ({
        ...i,
        performedBy: emailRef.current,
        timestamp: new Date().toISOString(),
      }));
      const itemsMap = new Map(itemsRef.current.map((i) => [i.id, i]));
      const ordersMap = new Map(ordersRef.current.map((o) => [o.id, o]));
      applyToInventoryMap(itemsMap, stamped);
      applyToOrdersMap(ordersMap, stamped);
      const newItems = Array.from(itemsMap.values());
      const newOrders = Array.from(ordersMap.values());
      const newKnown = [...knownRef.current, ...stamped];
      const newTx = [...txRef.current, ...stamped];
      writeCounterRef.current++;
      setKnown(newKnown);
      setTransactionsRaw(newTx);
      setItems(newItems);
      setOrders(newOrders);
      return { transactions: newTx, known: newKnown, items: newItems, orders: newOrders };
    }
    const result = await appendTransactions(inputs);
    writeCounterRef.current++;
    setTransactionsRaw(result.transactions);
    setKnown(result.known);
    setItems(result.items);
    setOrders(result.orders);
    return result;
  }, []);

  const addItem = useCallback(async (data: Omit<ItemCreateData, 'quantity'> & { quantity?: number }): Promise<InventoryItem> => {
    const itemId = uuidv4();
    const qty = data.quantity ?? 0;
    const inputData: ItemCreateData = { ...data, quantity: qty } as ItemCreateData;
    const tx: TransactionInput = { id: uuidv4(), type: 'item-create', itemId, data: inputData };
    const result = await commit([tx]);
    return findOrThrow(result.items, itemId, 'addItem');
  }, [commit]);

  const updateItem = useCallback(async (itemId: string, data: ItemUpdateData) => {
    const tx: TransactionInput = { id: uuidv4(), type: 'item-update', itemId, data };
    await commit([tx]);
  }, [commit]);

  const deleteItem = useCallback(async (itemId: string, note?: string) => {
    const tx: TransactionInput = { id: uuidv4(), type: 'item-delete', itemId, data: { note } };
    await commit([tx]);
  }, [commit]);

  const stockIn = useCallback(async (
    itemId: string,
    quantity: number,
    opts?: { lotNumber?: string; expirationDate?: string; note?: string; orderId?: string },
  ) => {
    const data: StockData = {
      quantity,
      lotNumber: opts?.lotNumber,
      expirationDate: opts?.expirationDate,
      note: opts?.note,
      orderId: opts?.orderId,
    };
    const tx: TransactionInput = { id: uuidv4(), type: 'stock-in', itemId, data };
    await commit([tx]);
  }, [commit]);

  const stockOut = useCallback(async (itemId: string, quantity: number, note?: string) => {
    const data: StockData = { quantity, note };
    const tx: TransactionInput = { id: uuidv4(), type: 'stock-out', itemId, data };
    await commit([tx]);
  }, [commit]);

  function buildCreateOrderBatch(orderId: string, input: OrderCreateInput): {
    itemCreates: TransactionInput[];
    orderCreateTx: TransactionInput;
  } {
    const itemCreates: TransactionInput[] = [];
    const lineItemsForOrder: OrderCreateLineItem[] = [];
    for (const line of input.lineItems) {
      let resolvedItemId = line.itemId;
      if (line.quickAdd) {
        const newItemId = uuidv4();
        const stub: ItemCreateData = {
          sku: rollStubSku(),
          name: line.name,
          quantity: 0,
          location: 'Unspecified',
          category: 'Uncategorized',
          supplier: input.supplier,
          unitCost: line.unitCost,
          reorderPoint: 0,
          vendor: input.supplier,
          referenceNumber: input.poNumber,
          unitOfMeasure: line.unitOfMeasure,
          isStub: true,
        };
        itemCreates.push({ id: uuidv4(), type: 'item-create', itemId: newItemId, data: stub });
        resolvedItemId = newItemId;
      }
      if (!resolvedItemId) {
        throw new Error('Order line missing itemId and quickAdd not set');
      }
      lineItemsForOrder.push({
        id: uuidv4(),
        itemId: resolvedItemId,
        name: line.name,
        unitOfMeasure: line.unitOfMeasure,
        quantityOrdered: line.quantityOrdered,
        unitCost: line.unitCost,
      });
    }

    const orderCreateData: OrderCreateData = {
      poNumber: input.poNumber,
      orderConfirmationNumber: input.orderConfirmationNumber,
      supplier: input.supplier,
      orderDate: todayISO(),
      expectedDeliveryDate: input.expectedDeliveryDate ?? null,
      lineItems: lineItemsForOrder,
      attachments: [],
      note: input.note ?? null,
    };
    const orderCreateTx: TransactionInput = {
      id: uuidv4(),
      type: 'order-create',
      itemId: orderId,
      data: orderCreateData,
    };

    return { itemCreates, orderCreateTx };
  }

  async function uploadAttachmentsBatch(
    orderId: string,
    files: File[] | undefined,
    stage: 'placed' | 'received',
  ): Promise<OrderAttachment[]> {
    if (!msalConfigured || !files || files.length === 0) return [];
    await ensureOrderFolder(orderId);
    const results = await Promise.allSettled(
      files.map((f) => uploadOrderAttachment(orderId, f, stage)),
    );
    const uploaded: OrderAttachment[] = [];
    let firstError: unknown = null;
    for (const r of results) {
      if (r.status === 'fulfilled') uploaded.push(r.value);
      else if (firstError === null) firstError = r.reason;
    }
    if (firstError !== null) {
      await Promise.allSettled(uploaded.map((a) => deleteOrderAttachment(orderId, a.filename)));
      throw firstError;
    }
    return uploaded;
  }

  /**
   * Run `op`; on a definite failure, best-effort delete the uploaded
   * attachments and rethrow. Two error types signal "write outcome may have
   * persisted attachment refs in the log" — DO NOT delete in either case:
   *   - WriteIndeterminateError: post-PUT recheck couldn't confirm the result.
   *   - BatchPartiallyCommittedError: a prior attempt's write landed; the
   *     current op throws because of the duplicate, but the persisted log
   *     already references these attachments.
   * Admin pruning catches real orphans.
   */
  async function withAttachmentCleanup<T>(
    orderId: string,
    uploaded: OrderAttachment[],
    op: () => Promise<T>,
  ): Promise<T> {
    try {
      return await op();
    } catch (err) {
      if (err instanceof WriteIndeterminateError) throw err;
      if (err instanceof BatchPartiallyCommittedError) throw err;
      if (uploaded.length > 0) {
        await Promise.allSettled(uploaded.map((a) => deleteOrderAttachment(orderId, a.filename)));
      }
      throw err;
    }
  }

  const createOrder = useCallback(async (input: OrderCreateInput): Promise<Order> => {
    const orderId = uuidv4();
    const { itemCreates, orderCreateTx } = buildCreateOrderBatch(orderId, input);
    const uploaded = await uploadAttachmentsBatch(orderId, input.attachments, 'placed');

    if (uploaded.length > 0) {
      (orderCreateTx.data as OrderCreateData).attachments = uploaded;
    }

    return withAttachmentCleanup(orderId, uploaded, async () => {
      const result = await commit([...itemCreates, orderCreateTx]);
      return findOrThrow(result.orders, orderId, 'createOrder');
    });
  }, [commit]);

  const receiveOrder = useCallback(async (orderId: string, input: OrderReceiveInput): Promise<Order> => {
    const order = ordersRef.current.find((o) => o.id === orderId);
    if (!order) throw new Error(`Order not found: ${orderId}`);

    const uploaded = await uploadAttachmentsBatch(orderId, input.attachments, 'received');

    const stockInTxs: TransactionInput[] = [];
    for (const recv of input.receivedLines) {
      if (recv.quantityReceived <= 0) continue;
      const line = order.lineItems.find((l) => l.id === recv.id);
      if (!line) throw new Error(`Received line ${recv.id} not in order ${orderId}`);
      stockInTxs.push({
        id: uuidv4(),
        type: 'stock-in',
        itemId: line.itemId,
        data: {
          quantity: recv.quantityReceived,
          lotNumber: recv.lotNumber,
          expirationDate: recv.expirationDate,
          orderId,
        } as StockData,
      });
    }
    const orderReceiveTx: TransactionInput = {
      id: uuidv4(),
      type: 'order-receive',
      itemId: orderId,
      data: {
        actualReceiveDate: input.actualReceiveDate,
        receivedLines: input.receivedLines,
        attachments: uploaded,
      } as OrderReceiveData,
    };

    return withAttachmentCleanup(orderId, uploaded, async () => {
      const result = await commit([orderReceiveTx, ...stockInTxs]);
      return findOrThrow(result.orders, orderId, 'receiveOrder');
    });
  }, [commit]);

  const cancelOrder = useCallback(async (orderId: string, note?: string): Promise<Order> => {
    const data: OrderCancelData = { note };
    const tx: TransactionInput = { id: uuidv4(), type: 'order-cancel', itemId: orderId, data };
    const result = await commit([tx]);
    return findOrThrow(result.orders, orderId, 'cancelOrder');
  }, [commit]);

  /**
   * Atomic cancel-and-recreate. Batch order MUST be `[itemCreates..., cancel, create]`:
   * the staged validator processes cancel first so the recreate's PO# uniqueness
   * check passes against a now-cancelled predecessor.
   *
   * Attachments uploaded for the replacement land under the NEW order id —
   * the predecessor's folder is left as-is.
   */
  const cancelAndRecreate = useCallback(async (predecessorId: string, input: OrderCreateInput): Promise<Order> => {
    const replacementOrderId = uuidv4();
    const { itemCreates, orderCreateTx } = buildCreateOrderBatch(replacementOrderId, input);
    const uploaded = await uploadAttachmentsBatch(replacementOrderId, input.attachments, 'placed');

    if (uploaded.length > 0) {
      (orderCreateTx.data as OrderCreateData).attachments = uploaded;
    }

    const cancelTx: TransactionInput = {
      id: uuidv4(),
      type: 'order-cancel',
      itemId: predecessorId,
      data: { note: `Replaced by ${input.poNumber}`, replacedBy: replacementOrderId } as OrderCancelData,
    };

    return withAttachmentCleanup(replacementOrderId, uploaded, async () => {
      const result = await commit([...itemCreates, cancelTx, orderCreateTx]);
      return findOrThrow(result.orders, replacementOrderId, 'cancelAndRecreate');
    });
  }, [commit]);

  const findLatestLineItemForItem = useCallback((itemId: string): OrderLineItem | null => {
    let best: { orderDate: string; line: OrderLineItem } | null = null;
    for (const o of orders) {
      if (o.status === 'cancelled') continue;
      for (const line of o.lineItems) {
        if (line.itemId !== itemId) continue;
        if (!best || o.orderDate > best.orderDate) best = { orderDate: o.orderDate, line };
      }
    }
    return best?.line ?? null;
  }, [orders]);

  const value = useMemo<InventoryContextValue>(() => ({
    items, orders, transactions: known, isAdmin: adminFlag, loading, error,
    addItem, updateItem, deleteItem, stockIn, stockOut,
    createOrder, receiveOrder, cancelOrder, cancelAndRecreate,
    findLatestLineItemForItem,
  }), [
    items, orders, known, adminFlag, loading, error,
    addItem, updateItem, deleteItem, stockIn, stockOut,
    createOrder, receiveOrder, cancelOrder, cancelAndRecreate,
    findLatestLineItemForItem,
  ]);

  return (
    <InventoryContext.Provider value={value}>
      {children}
    </InventoryContext.Provider>
  );
}
