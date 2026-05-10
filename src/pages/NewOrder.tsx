import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams, Navigate } from 'react-router-dom';
import { useInventory } from '../context/InventoryContext';
import type { OrderCreateInput } from '../context/inventoryTypes';
import type { InventoryItem } from '../models/inventory';
import type { Order } from '../models/order';
import { ATTACHMENT_ACCEPT_ATTRIBUTE, mergeFilesDedup } from '../api/attachmentService';
import { useClickOutside } from '../hooks/useClickOutside';

interface DraftLine {
  /** internal-only identifier for React keys; transformed into payload below */
  rowKey: string;
  itemId?: string;
  /** True iff the user picked "+ Create new item" */
  quickAdd: boolean;
  name: string;
  unitOfMeasure: string;
  quantityOrdered: string;
  unitCost: string;
  /** Hint shown if findLatestLineItemForItem returned null AND there are cancelled orders for this item */
  autofillHint?: string;
}

const newRow = (): DraftLine => ({
  rowKey: crypto.randomUUID(),
  quickAdd: false,
  name: '',
  unitOfMeasure: 'each',
  quantityOrdered: '1',
  unitCost: '0',
});

interface ItemPickerProps {
  index: number;
  value: string;
  /** True iff parent has either an existing-item selection (itemId set) or a quick-add intent. */
  hasSelection: boolean;
  onSelectExisting: (item: InventoryItem) => void;
  onQuickAdd: (name: string) => void;
  /** Called when the user edits the input after a selection — parent should clear itemId/quickAdd. */
  onClearSelection: () => void;
}

function ItemPicker({ index, value, hasSelection, onSelectExisting, onQuickAdd, onClearSelection }: ItemPickerProps) {
  const { items } = useInventory();
  const [query, setQuery] = useState(value);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => { setQuery(value); }, [value]);
  useClickOutside(ref, useCallback(() => setOpen(false), []), open);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items.filter(i => !i.isStub).slice(0, 10);
    return items
      .filter((i) => !i.isStub && (i.sku.toLowerCase().includes(q) || i.name.toLowerCase().includes(q)))
      .slice(0, 20);
  }, [items, query]);

  return (
    <div className="item-selector" ref={ref}>
      <input
        type="text"
        className="form-input"
        placeholder="Search inventory by SKU or name..."
        value={query}
        onChange={(e) => {
          const next = e.target.value;
          setQuery(next);
          setOpen(true);
          // If the user edits after a selection, drop the selection so they
          // can't submit a name they edited away from. Re-pick required.
          if (hasSelection && next !== value) onClearSelection();
        }}
        onFocus={() => setOpen(true)}
        data-line-index={index}
      />
      {open && (
        <div className="item-selector-dropdown">
          {matches.map((it) => (
            <div
              key={it.id}
              className="item-selector-option"
              onClick={() => {
                onSelectExisting(it);
                setOpen(false);
              }}
            >
              <span className="cell-sku">{it.sku}</span>
              <span className="cell-name">{it.name}</span>
              <span className="cell-mono" style={{ marginLeft: 'auto', color: 'var(--text-muted)' }}>
                qty: {it.quantity}
              </span>
            </div>
          ))}
          {query.trim() && (
            <div
              className="item-selector-option"
              style={{ borderTop: '1px solid var(--border)', color: 'var(--accent)' }}
              onClick={() => { onQuickAdd(query.trim()); setOpen(false); }}
            >
              + Create new item: <strong>{query.trim()}</strong>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function NewOrder() {
  const [searchParams] = useSearchParams();
  const fromOrderId = searchParams.get('from');
  const { orders, loading } = useInventory();

  if (fromOrderId && loading) {
    return (
      <main className="page">
        <div className="placeholder-page">
          <div className="placeholder-text">Loading order...</div>
        </div>
      </main>
    );
  }

  if (fromOrderId) {
    const predecessor = orders.find((o) => o.id === fromOrderId);
    if (!predecessor) return <Navigate to="/orders" replace />;
    if (predecessor.status !== 'placed') return <Navigate to={`/orders/${predecessor.id}`} replace />;
    return <OrderForm key={predecessor.id} predecessor={predecessor} />;
  }
  return <OrderForm key="new" predecessor={null} />;
}

function OrderForm({ predecessor }: { predecessor: Order | null }) {
  const navigate = useNavigate();
  const { items, orders, createOrder, cancelAndRecreate, findLatestLineItemForItem } = useInventory();
  const isEditMode = predecessor !== null;

  // Lazy initial state — read predecessor once at mount. Parent uses
  // key={predecessor.id} so navigating between edits remounts cleanly.
  const [poNumber, setPoNumber] = useState(predecessor?.poNumber ?? '');
  const [confirmation, setConfirmation] = useState(predecessor?.orderConfirmationNumber ?? '');
  const [supplier, setSupplier] = useState(predecessor?.supplier ?? '');
  const [expectedDelivery, setExpectedDelivery] = useState(predecessor?.expectedDeliveryDate ?? '');
  const [note, setNote] = useState(predecessor?.note ?? '');
  const [lines, setLines] = useState<DraftLine[]>(() => predecessor
    ? predecessor.lineItems.map((l) => ({
        rowKey: crypto.randomUUID(),
        itemId: l.itemId,
        quickAdd: false,
        name: l.name,
        unitOfMeasure: l.unitOfMeasure,
        quantityOrdered: String(l.quantityOrdered),
        unitCost: String(l.unitCost),
      }))
    : [newRow()]);
  const [attachments, setAttachments] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const knownSuppliers = useMemo(
    () => [...new Set([...items.map(i => i.supplier), ...orders.map(o => o.supplier)])].filter(Boolean).sort(),
    [items, orders],
  );

  const itemsWithCancelledOrders = useMemo(() => {
    const set = new Set<string>();
    for (const o of orders) {
      if (o.status !== 'cancelled') continue;
      for (const l of o.lineItems) set.add(l.itemId);
    }
    return set;
  }, [orders]);

  function selectExistingItem(rowKey: string, item: InventoryItem) {
    const latest = findLatestLineItemForItem(item.id);
    const cancelledForItem = itemsWithCancelledOrders.has(item.id);
    setLines((prev) => prev.map((l) => l.rowKey !== rowKey ? l : {
      ...l,
      itemId: item.id,
      quickAdd: false,
      name: item.name,
      unitOfMeasure: latest?.unitOfMeasure || item.unitOfMeasure || 'each',
      quantityOrdered: String(latest?.quantityOrdered ?? 1),
      unitCost: String(latest?.unitCost ?? item.unitCost ?? 0),
      autofillHint: !latest && cancelledForItem
        ? 'All prior orders for this item were cancelled — using item defaults.'
        : undefined,
    }));
  }

  function quickAdd(rowKey: string, name: string) {
    setLines((prev) => prev.map((l) => l.rowKey !== rowKey ? l : {
      ...l, itemId: undefined, quickAdd: true, name, autofillHint: undefined,
    }));
  }

  function clearLineSelection(rowKey: string) {
    setLines((prev) => prev.map((l) => l.rowKey !== rowKey ? l : {
      ...l, itemId: undefined, quickAdd: false, autofillHint: undefined,
    }));
  }

  function updateLine(rowKey: string, patch: Partial<DraftLine>) {
    setLines((prev) => prev.map((l) => l.rowKey === rowKey ? { ...l, ...patch } : l));
  }

  function addRow() { setLines((prev) => [...prev, newRow()]); }
  function removeRow(rowKey: string) { setLines((prev) => prev.filter((l) => l.rowKey !== rowKey)); }

  const total = useMemo(() =>
    lines.reduce((sum, l) => sum + (parseFloat(l.unitCost) || 0) * (parseFloat(l.quantityOrdered) || 0), 0),
  [lines]);

  function valid(): boolean {
    if (!poNumber.trim() || !confirmation.trim() || !supplier.trim()) return false;
    if (lines.length === 0) return false;
    for (const l of lines) {
      if (!l.name.trim()) return false;
      if (!l.unitOfMeasure.trim()) return false;
      const q = parseFloat(l.quantityOrdered);
      if (!q || q <= 0) return false;
      const c = parseFloat(l.unitCost);
      if (Number.isNaN(c) || c < 0) return false;
      if (!l.quickAdd && !l.itemId) return false;
    }
    // PO# must match the schema regex (mirrors validation, surfaced live)
    if (!/^[A-Za-z0-9-]{1,32}$/.test(poNumber.trim())) return false;
    return true;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const input: OrderCreateInput = {
        poNumber: poNumber.trim(),
        orderConfirmationNumber: confirmation.trim(),
        supplier: supplier.trim(),
        expectedDeliveryDate: expectedDelivery || null,
        note: note.trim() || null,
        lineItems: lines.map((l) => ({
          quickAdd: l.quickAdd,
          itemId: l.itemId,
          name: l.name.trim(),
          unitOfMeasure: l.unitOfMeasure.trim(),
          quantityOrdered: parseInt(l.quantityOrdered, 10),
          unitCost: parseFloat(l.unitCost),
        })),
        attachments,
      };
      const order = isEditMode && predecessor
        ? await cancelAndRecreate(predecessor.id, input)
        : await createOrder(input);
      navigate(`/orders/${order.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  }

  return (
    <main className="page">
      <div className="page-header">
        <h1 className="page-title">{isEditMode ? `Edit PO ${predecessor!.poNumber}` : 'New Purchase Order'}</h1>
        <span className="page-subtitle">
          {isEditMode
            ? 'Saving will cancel the original and create a replacement in one atomic batch.'
            : 'Place an order with a supplier'}
        </span>
      </div>

      {isEditMode && (
        <div
          className="toast toast--error"
          style={{ position: 'static', marginBottom: '16px', maxWidth: '1100px' }}
        >
          Editing PO {predecessor!.poNumber} — saving cancels the original and creates a replacement
          in one atomic batch. Closing this tab without saving leaves the original active.
          Attach any documents you want on the replacement below; the predecessor's documents
          remain on the cancelled order.
        </div>
      )}

      <form onSubmit={handleSubmit}>
        {/* Header */}
        <div className="stock-form-card" style={{ maxWidth: '960px', animation: 'cardIn 0.4s ease-out both' }}>
          <div className="panel__header">
            <span className="panel__title">
              <span className="panel__title-dot" style={{ background: 'var(--info)' }} />
              Order Header
            </span>
          </div>
          <div className="stock-form-body">
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">PO Number *</label>
                <input
                  className="form-input"
                  placeholder="e.g. PO-2026-0050"
                  value={poNumber}
                  onChange={(e) => setPoNumber(e.target.value)}
                  required
                />
                {poNumber.trim() && !/^[A-Za-z0-9-]{1,32}$/.test(poNumber.trim()) && (
                  <span className="form-hint" style={{ color: 'var(--critical)' }}>
                    PO# must be 1–32 ASCII alphanumerics or dashes
                  </span>
                )}
              </div>
              <div className="form-group">
                <label className="form-label">Order Confirmation # *</label>
                <input
                  className="form-input"
                  placeholder="From supplier confirmation"
                  value={confirmation}
                  onChange={(e) => setConfirmation(e.target.value)}
                  required
                />
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Supplier *</label>
                <input
                  className="form-input"
                  list="known-suppliers"
                  placeholder="e.g. Thermo Fisher"
                  value={supplier}
                  onChange={(e) => setSupplier(e.target.value)}
                  required
                />
                <datalist id="known-suppliers">
                  {knownSuppliers.map((s) => <option key={s} value={s} />)}
                </datalist>
              </div>
              <div className="form-group">
                <label className="form-label">Expected Delivery</label>
                <input
                  className="form-input"
                  type="date"
                  value={expectedDelivery}
                  onChange={(e) => setExpectedDelivery(e.target.value)}
                />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Note (optional)</label>
              <input
                className="form-input"
                placeholder="Internal note about this order"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
          </div>
        </div>

        {/* Line items */}
        <div className="stock-form-card" style={{ maxWidth: '1100px', marginTop: '24px', animation: 'cardIn 0.4s ease-out 0.1s both' }}>
          <div className="panel__header">
            <span className="panel__title">
              <span className="panel__title-dot" />
              Line Items ({lines.length})
            </span>
            <span className="panel__count">Total: ${total.toFixed(2)}</span>
          </div>
          <div className="stock-form-body">
            {lines.map((line, i) => (
              <div key={line.rowKey} style={{ borderBottom: i < lines.length - 1 ? '1px solid var(--border)' : 'none', paddingBottom: '12px', marginBottom: '12px' }}>
                <div className="form-row">
                  <div className="form-group" style={{ flex: 2 }}>
                    <label className="form-label">Item *</label>
                    <ItemPicker
                      index={i}
                      value={line.name}
                      hasSelection={Boolean(line.itemId) || line.quickAdd}
                      onSelectExisting={(it) => selectExistingItem(line.rowKey, it)}
                      onQuickAdd={(name) => quickAdd(line.rowKey, name)}
                      onClearSelection={() => clearLineSelection(line.rowKey)}
                    />
                    {line.quickAdd && (
                      <span className="form-hint" style={{ color: 'var(--accent)' }}>
                        Will create new item on save (stub — refine on inventory page later)
                      </span>
                    )}
                    {line.autofillHint && (
                      <span className="form-hint" style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>
                        {line.autofillHint}
                      </span>
                    )}
                  </div>
                  <div className="form-group" style={{ maxWidth: '120px' }}>
                    <label className="form-label">UoM *</label>
                    <input
                      className="form-input"
                      placeholder="each"
                      value={line.unitOfMeasure}
                      onChange={(e) => updateLine(line.rowKey, { unitOfMeasure: e.target.value })}
                    />
                  </div>
                  <div className="form-group" style={{ maxWidth: '100px' }}>
                    <label className="form-label">Qty *</label>
                    <input
                      className="form-input"
                      type="number"
                      min="1"
                      value={line.quantityOrdered}
                      onChange={(e) => updateLine(line.rowKey, { quantityOrdered: e.target.value })}
                    />
                  </div>
                  <div className="form-group" style={{ maxWidth: '120px' }}>
                    <label className="form-label">Unit Cost *</label>
                    <input
                      className="form-input"
                      type="number"
                      step="0.01"
                      min="0"
                      value={line.unitCost}
                      onChange={(e) => updateLine(line.rowKey, { unitCost: e.target.value })}
                    />
                  </div>
                  <div className="form-group" style={{ maxWidth: '90px', alignSelf: 'flex-end' }}>
                    {lines.length > 1 && (
                      <button type="button" className="btn btn-secondary" onClick={() => removeRow(line.rowKey)}>
                        Remove
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
            <button type="button" className="btn btn-secondary" onClick={addRow}>
              + Add line
            </button>
          </div>
        </div>

        <div className="stock-form-card" style={{ maxWidth: '1100px', marginTop: '24px', animation: 'cardIn 0.4s ease-out 0.15s both' }}>
          <div className="panel__header">
            <span className="panel__title">
              <span className="panel__title-dot" style={{ background: 'var(--accent)' }} />
              Order Documents (optional)
            </span>
            <span className="panel__count">{attachments.length} files</span>
          </div>
          <div className="stock-form-body">
            <input
              type="file"
              multiple
              accept={ATTACHMENT_ACCEPT_ATTRIBUTE}
              onChange={(e) => {
                const newFiles = Array.from(e.target.files || []);
                setAttachments((prev) => mergeFilesDedup(prev, newFiles));
                e.target.value = '';
              }}
            />
            {attachments.length > 0 && (
              <ul className="activity-list" style={{ marginTop: '12px' }}>
                {attachments.map((f, idx) => (
                  <li key={idx} className="activity-item">
                    <div className="activity-content">
                      <div className="activity-text">{f.name}</div>
                      <div className="activity-meta">
                        <span>{(f.size / 1024).toFixed(1)} KB</span>
                        <span>{f.type || 'unknown type'}</span>
                      </div>
                    </div>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      style={{ padding: '4px 10px', fontSize: '0.7rem' }}
                      onClick={() => setAttachments((prev) => prev.filter((_, i) => i !== idx))}
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="btn-group" style={{ justifyContent: 'flex-end', gap: '12px', marginTop: '24px', maxWidth: '1100px' }}>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => navigate(isEditMode && predecessor ? `/orders/${predecessor.id}` : '/orders')}
            disabled={submitting}
          >
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={!valid() || submitting}>
            {submitting
              ? 'Saving...'
              : isEditMode
                ? 'Cancel original & save replacement'
                : 'Place Order'}
          </button>
        </div>
        {error && (
          <div className="toast toast--error" style={{ position: 'static', maxWidth: '1100px' }}>
            {error}
          </div>
        )}
      </form>
    </main>
  );
}
