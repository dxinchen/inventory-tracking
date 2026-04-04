import { useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useInventory } from '../context/InventoryContext';
import type { StockData } from '../models/transaction';

export default function ItemDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { items, transactions, updateItem, deleteItem } = useInventory();

  const item = items.find(i => i.id === id);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const [toast, setToast] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const itemTransactions = useMemo(() => {
    if (!id) return [];
    return transactions.filter(t => t.itemId === id).reverse();
  }, [transactions, id]);

  if (!item) {
    return (
      <main className="page">
        <div className="placeholder-page">
          <div className="placeholder-icon">{'\u{1F50D}'}</div>
          <div className="placeholder-text">
            <strong>Item not found</strong>
            This item may have been deleted.
          </div>
          <button className="btn btn-secondary" onClick={() => navigate('/inventory')}>Back to Inventory</button>
        </div>
      </main>
    );
  }

  function startEdit() {
    setForm({
      name: item!.name,
      location: item!.location,
      category: item!.category,
      supplier: item!.supplier,
      vendor: item!.vendor,
      referenceNumber: item!.referenceNumber,
      unitCost: item!.unitCost != null ? String(item!.unitCost) : '',
      reorderPoint: String(item!.reorderPoint),
    });
    setEditing(true);
  }

  function saveEdit() {
    const changes: Record<string, string | number> = {};
    if (form.name !== item!.name) changes.name = form.name;
    if (form.location !== item!.location) changes.location = form.location;
    if (form.category !== item!.category) changes.category = form.category;
    if (form.supplier !== item!.supplier) changes.supplier = form.supplier;
    if (form.vendor !== item!.vendor) changes.vendor = form.vendor;
    if (form.referenceNumber !== item!.referenceNumber) changes.referenceNumber = form.referenceNumber;
    if (form.unitCost && parseFloat(form.unitCost) !== (item!.unitCost ?? 0)) changes.unitCost = parseFloat(form.unitCost);
    if (parseInt(form.reorderPoint, 10) !== item!.reorderPoint) changes.reorderPoint = parseInt(form.reorderPoint, 10);

    if (Object.keys(changes).length === 0) {
      setEditing(false);
      return;
    }

    updateItem(item!.id, changes);
    setEditing(false);
    setToast({ type: 'success', msg: `Updated ${Object.keys(changes).length} field(s)` });
    setTimeout(() => setToast(null), 3000);
  }

  function handleDelete() {
    deleteItem(item!.id, 'Deleted via UI');
    navigate('/inventory');
  }

  const typeLabels: Record<string, string> = {
    'stock-in': 'Stock In',
    'stock-out': 'Stock Out',
    'item-create': 'Created',
    'item-update': 'Updated',
    'item-delete': 'Deleted',
  };

  const typeBadge: Record<string, string> = {
    'stock-in': 'stock-in',
    'stock-out': 'stock-out',
    'item-create': 'create',
    'item-update': 'update',
    'item-delete': 'critical',
  };

  return (
    <main className="page">
      <div className="page-header" style={{ marginBottom: '16px' }}>
        <h1 className="page-title">{item.name}</h1>
        <span className="page-subtitle">{item.sku}</span>
      </div>

      <div style={{ display: 'flex', gap: '12px', marginBottom: '24px' }}>
        <button className="btn btn-secondary" onClick={() => navigate('/inventory')}>Back</button>
        {!editing && (
          <button className="btn btn-primary" onClick={startEdit}>Edit Item</button>
        )}
        {editing && (
          <>
            <button className="btn btn-primary" onClick={saveEdit}>Save Changes</button>
            <button className="btn btn-secondary" onClick={() => setEditing(false)}>Cancel</button>
          </>
        )}
        {!editing && !confirmDelete && (
          <button className="btn btn-danger" style={{ marginLeft: 'auto' }} onClick={() => setConfirmDelete(true)}>Delete</button>
        )}
        {confirmDelete && (
          <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px', alignItems: 'center' }}>
            <span style={{ fontSize: '0.8rem', color: 'var(--critical)' }}>Are you sure?</span>
            <button className="btn btn-danger" onClick={handleDelete}>Yes, Delete</button>
            <button className="btn btn-secondary" onClick={() => setConfirmDelete(false)}>No</button>
          </div>
        )}
      </div>

      <div className="dashboard-grid" style={{ alignItems: 'start' }}>
        {/* Left: Item fields */}
        <div className="panel" style={{ animation: 'cardIn 0.4s ease-out both' }}>
          <div className="panel__header">
            <span className="panel__title">
              <span className="panel__title-dot" />
              Details
            </span>
            <span className="panel__count">qty: {item.quantity}</span>
          </div>
          <div className="panel__body" style={{ padding: '0' }}>
            <table className="data-table">
              <tbody>
                {([
                  ['SKU', item.sku, null],
                  ['Name', item.name, 'name'],
                  ['Location', item.location, 'location'],
                  ['Category', item.category, 'category'],
                  ['Supplier', item.supplier, 'supplier'],
                  ['Vendor', item.vendor, 'vendor'],
                  ['Reference #', item.referenceNumber, 'referenceNumber'],
                  ['Unit Cost', item.unitCost != null ? `$${item.unitCost.toFixed(2)}` : '—', 'unitCost'],
                  ['Reorder Point', String(item.reorderPoint), 'reorderPoint'],
                  ['Quantity', String(item.quantity), null],
                  ['Earliest Expiry', item.earliestExpiration ? new Date(item.earliestExpiration).toLocaleDateString() : 'None', null],
                ] as [string, string, string | null][]).map(([label, value, editKey]) => (
                  <tr key={label}>
                    <td className="form-label" style={{ width: '140px', padding: '10px 16px' }}>{label}</td>
                    <td style={{ padding: '10px 16px' }}>
                      {editing && editKey ? (
                        <input
                          className="form-input"
                          style={{ padding: '6px 10px', fontSize: '0.8rem' }}
                          type="text"
                          inputMode={editKey === 'unitCost' || editKey === 'reorderPoint' ? 'decimal' : undefined}
                          placeholder={editKey === 'unitCost' ? 'e.g. 385.00' : undefined}
                          value={form[editKey] ?? ''}
                          onChange={e => setForm(prev => ({ ...prev, [editKey]: e.target.value }))}
                        />
                      ) : (
                        <span className="cell-mono">{value}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right: Batches + Activity */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Batches */}
          {item.batches.length > 0 && (
            <div className="panel" style={{ animation: 'cardIn 0.4s ease-out 0.1s both' }}>
              <div className="panel__header">
                <span className="panel__title">
                  <span className="panel__title-dot" style={{ background: 'var(--expiring)' }} />
                  Lot / Batch Inventory
                </span>
                <span className="panel__count">{item.batches.length} batches</span>
              </div>
              <div className="panel__body">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Lot #</th>
                      <th>Qty</th>
                      <th>Expires</th>
                      <th>Received</th>
                    </tr>
                  </thead>
                  <tbody>
                    {item.batches.map((batch, i) => (
                      <tr key={i}>
                        <td className="cell-sku">{batch.lotNumber}</td>
                        <td className="cell-mono">{batch.quantity}</td>
                        <td className="cell-mono">{batch.expirationDate ? new Date(batch.expirationDate).toLocaleDateString() : '—'}</td>
                        <td className="cell-mono" style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>
                          {new Date(batch.receivedAt).toLocaleDateString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Transaction history */}
          <div className="panel" style={{ animation: 'cardIn 0.4s ease-out 0.15s both' }}>
            <div className="panel__header">
              <span className="panel__title">
                <span className="panel__title-dot" />
                Activity Log
              </span>
              <span className="panel__count">{itemTransactions.length} entries</span>
            </div>
            <div className="panel__body">
              {itemTransactions.length === 0 ? (
                <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                  No activity recorded yet
                </div>
              ) : (
                <ul className="activity-list" style={{ maxHeight: '360px' }}>
                  {itemTransactions.map(tx => {
                    const qty = (tx.data as StockData).quantity;
                    const note = (tx.data as StockData).note as string | undefined;
                    return (
                      <li key={tx.id} className="activity-item">
                        <div className="activity-content">
                          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '4px' }}>
                            <span className={`badge badge--${typeBadge[tx.type]}`}>{typeLabels[tx.type]}</span>
                            {qty && tx.type === 'stock-in' && <span className="qty-change qty-change--plus">+{qty}</span>}
                            {qty && tx.type === 'stock-out' && <span className="qty-change qty-change--minus">-{qty}</span>}
                          </div>
                          {note && <div className="activity-text" style={{ fontSize: '0.75rem' }}>{note}</div>}
                          {tx.type === 'item-update' && (
                            <div className="activity-text" style={{ fontSize: '0.75rem' }}>
                              Changed: {Object.keys(tx.data).filter(k => k !== 'note').join(', ')}
                            </div>
                          )}
                          <div className="activity-meta">
                            <span>{tx.performedBy.split('@')[0]}</span>
                            <span>{new Date(tx.timestamp).toLocaleString()}</span>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </div>
      </div>

      {toast && <div className={`toast toast--${toast.type}`}>{toast.msg}</div>}
    </main>
  );
}
