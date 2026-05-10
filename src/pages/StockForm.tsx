import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { useInventory } from '../context/InventoryContext';
import type { InventoryItem } from '../models/inventory';
import { useClickOutside } from '../hooks/useClickOutside';

type Direction = 'in' | 'out';

export default function StockForm() {
  const { items, stockIn, stockOut } = useInventory();
  const [direction, setDirection] = useState<Direction>('in');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(null);
  const [quantity, setQuantity] = useState('');
  const [note, setNote] = useState('');
  const [lotNumber, setLotNumber] = useState('');
  const [expirationDate, setExpirationDate] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const filteredItems = useMemo(() => {
    const visible = items.filter(i => !i.isStub);
    if (!searchQuery) return visible;
    const q = searchQuery.toLowerCase();
    return visible.filter(i => i.sku.toLowerCase().includes(q) || i.name.toLowerCase().includes(q));
  }, [items, searchQuery]);

  useClickOutside(dropdownRef, useCallback(() => setShowDropdown(false), []), showDropdown);

  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  async function handleSubmit() {
    if (!selectedItem || submitting) return;
    const qty = parseInt(quantity, 10);
    if (!qty || qty <= 0) {
      setToast({ type: 'error', msg: 'Quantity must be greater than 0' });
      return;
    }
    if (direction === 'out' && qty > selectedItem.quantity) {
      setToast({ type: 'error', msg: `Insufficient stock. Current: ${selectedItem.quantity}` });
      return;
    }

    setSubmitting(true);
    try {
      if (direction === 'in') {
        await stockIn(selectedItem.id, qty, {
          lotNumber: lotNumber || undefined,
          expirationDate: expirationDate || undefined,
          note: note || undefined,
        });
      } else {
        await stockOut(selectedItem.id, qty, note || undefined);
      }
      const verb = direction === 'in' ? 'Received' : 'Used';
      setToast({ type: 'success', msg: `${verb} ${qty}x ${selectedItem.name}` });
      setQuantity('');
      setNote('');
      setLotNumber('');
      setExpirationDate('');
      setSelectedItem(null);
      setSearchQuery('');
    } catch (err) {
      setToast({ type: 'error', msg: err instanceof Error ? err.message : String(err) });
    } finally {
      setSubmitting(false);
    }
  }

  const isValid = selectedItem && quantity && parseInt(quantity, 10) > 0 && !submitting;

  return (
    <main className="page">
      <div className="page-header">
        <h1 className="page-title">Stock In / Out</h1>
        <span className="page-subtitle">Record inventory movements</span>
      </div>

      <div className="stock-form-card" style={{ animation: 'cardIn 0.4s ease-out both' }}>
        <div className="panel__header">
          <span className="panel__title">
            <span className="panel__title-dot" style={{ background: direction === 'in' ? 'var(--ok)' : 'var(--critical)' }} />
            {direction === 'in' ? 'Receiving Stock' : 'Using Stock'}
          </span>
        </div>

        <div className="stock-form-body">
          {/* Direction Toggle */}
          <div className="form-group">
            <label className="form-label">Direction</label>
            <div className="toggle-group">
              <button
                className={`toggle-option ${direction === 'in' ? 'active-in' : ''}`}
                onClick={() => setDirection('in')}
              >
                Receiving
              </button>
              <button
                className={`toggle-option ${direction === 'out' ? 'active-out' : ''}`}
                onClick={() => setDirection('out')}
              >
                Using
              </button>
            </div>
          </div>

          {/* Item Selector */}
          <div className="form-group">
            <label className="form-label">Select Item</label>
            <div className="item-selector" ref={dropdownRef}>
              <input
                type="text"
                className="form-input"
                placeholder="Search by SKU or name..."
                value={selectedItem ? `${selectedItem.sku} — ${selectedItem.name}` : searchQuery}
                onChange={e => {
                  setSearchQuery(e.target.value);
                  setSelectedItem(null);
                  setShowDropdown(true);
                }}
                onFocus={() => !selectedItem && setShowDropdown(true)}
              />
              {showDropdown && !selectedItem && (
                <div className="item-selector-dropdown">
                  {filteredItems.length === 0 ? (
                    <div style={{ padding: '14px', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                      No items found
                    </div>
                  ) : (
                    filteredItems.map(item => (
                      <div
                        key={item.id}
                        className="item-selector-option"
                        onClick={() => {
                          setSelectedItem(item);
                          setSearchQuery('');
                          setShowDropdown(false);
                        }}
                      >
                        <span className="cell-sku">{item.sku}</span>
                        <span className="cell-name">{item.name}</span>
                        <span className="cell-mono" style={{ marginLeft: 'auto', color: 'var(--text-muted)' }}>
                          qty: {item.quantity}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Selected Item Info */}
          {selectedItem && (
            <div className="selected-item-info">
              <div>
                <div className="selected-item-label">Current Stock</div>
                <div className="selected-item-qty">{selectedItem.quantity}</div>
              </div>
              <div style={{ borderLeft: '1px solid var(--border)', paddingLeft: '16px' }}>
                <div className="selected-item-label">Location</div>
                <div className="cell-mono" style={{ fontSize: '0.85rem', color: 'var(--text-primary)' }}>
                  {selectedItem.location}
                </div>
              </div>
              <div style={{ borderLeft: '1px solid var(--border)', paddingLeft: '16px' }}>
                <div className="selected-item-label">Unit Cost</div>
                <div className="cell-mono" style={{ fontSize: '0.85rem', color: 'var(--text-primary)' }}>
                  {selectedItem.unitCost != null ? `$${selectedItem.unitCost.toFixed(2)}` : '—'}
                </div>
              </div>
              <button
                className="btn btn-secondary"
                style={{ marginLeft: 'auto', padding: '6px 12px', fontSize: '0.7rem' }}
                onClick={() => { setSelectedItem(null); setSearchQuery(''); }}
              >
                Change
              </button>
            </div>
          )}

          {/* Quantity & Note */}
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Quantity</label>
              <input
                type="number"
                className="form-input"
                placeholder="0"
                min="1"
                value={quantity}
                onChange={e => setQuantity(e.target.value)}
              />
              {direction === 'out' && selectedItem && quantity && parseInt(quantity, 10) > selectedItem.quantity && (
                <span className="form-hint" style={{ color: 'var(--critical)' }}>
                  Exceeds current stock ({selectedItem.quantity})
                </span>
              )}
              {direction === 'out' && selectedItem && quantity && parseInt(quantity, 10) > 0 && parseInt(quantity, 10) <= selectedItem.quantity && (
                <span className="form-hint">
                  After: {selectedItem.quantity - parseInt(quantity, 10)} remaining
                  {selectedItem.quantity - parseInt(quantity, 10) <= selectedItem.reorderPoint && ' (low stock warning)'}
                </span>
              )}
            </div>
            <div className="form-group">
              <label className="form-label">Note (optional)</label>
              <input
                type="text"
                className="form-input"
                placeholder="PO number, reason, etc."
                value={note}
                onChange={e => setNote(e.target.value)}
              />
            </div>
          </div>

          {/* Lot / Expiration (stock-in only) */}
          {direction === 'in' && (
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Lot Number</label>
                <input className="form-input" placeholder="e.g. TF-24B220" value={lotNumber} onChange={e => setLotNumber(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">Expiration Date</label>
                <input className="form-input" type="date" value={expirationDate} onChange={e => setExpirationDate(e.target.value)} />
              </div>
            </div>
          )}

          {/* Submit */}
          <div className="btn-group" style={{ justifyContent: 'flex-end' }}>
            <button className="btn btn-primary" disabled={!isValid} onClick={handleSubmit}>
              {submitting ? 'Saving...' : (direction === 'in' ? 'Record Receiving' : 'Record Usage')}
            </button>
          </div>
        </div>
      </div>

      {toast && (
        <div className={`toast toast--${toast.type}`}>{toast.msg}</div>
      )}
    </main>
  );
}
