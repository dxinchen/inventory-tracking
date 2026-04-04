import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useInventory } from '../context/InventoryContext';

export default function NewItem() {
  const { addItem } = useInventory();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    sku: '', name: '', quantity: '0', location: '', category: '', supplier: '',
    unitCost: '0', reorderPoint: '0', vendor: '', referenceNumber: '',
    lotNumber: '', expirationDate: '',
  });
  const [toast, setToast] = useState('');

  function set(field: string, value: string) {
    setForm(prev => ({ ...prev, [field]: value }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.sku || !form.name) return;

    const item = addItem({
      sku: form.sku,
      name: form.name,
      quantity: parseInt(form.quantity, 10) || 0,
      location: form.location,
      category: form.category,
      supplier: form.supplier,
      unitCost: parseFloat(form.unitCost) || 0,
      reorderPoint: parseInt(form.reorderPoint, 10) || 0,
      vendor: form.vendor,
      referenceNumber: form.referenceNumber,
      lotNumber: form.lotNumber || undefined,
      expirationDate: form.expirationDate || undefined,
    });

    setToast(`Created ${item.name}`);
    setTimeout(() => navigate(`/inventory/${item.id}`), 800);
  }

  return (
    <main className="page">
      <div className="page-header">
        <h1 className="page-title">New Item</h1>
        <span className="page-subtitle">Add a new product to inventory</span>
      </div>

      <form onSubmit={handleSubmit}>
        <div className="stock-form-card" style={{ maxWidth: '800px', animation: 'cardIn 0.4s ease-out both' }}>
          <div className="panel__header">
            <span className="panel__title">
              <span className="panel__title-dot" style={{ background: 'var(--info)' }} />
              Item Details
            </span>
          </div>

          <div className="stock-form-body">
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">SKU *</label>
                <input className="form-input" placeholder="e.g. PCR-001" value={form.sku} onChange={e => set('sku', e.target.value)} required />
              </div>
              <div className="form-group">
                <label className="form-label">Name *</label>
                <input className="form-input" placeholder="e.g. PCR Tubes 0.2mL (1000pk)" value={form.name} onChange={e => set('name', e.target.value)} required />
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Category</label>
                <input className="form-input" placeholder="e.g. Consumables" value={form.category} onChange={e => set('category', e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">Location</label>
                <input className="form-input" placeholder="e.g. Room 102, Shelf A3" value={form.location} onChange={e => set('location', e.target.value)} />
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Supplier</label>
                <input className="form-input" placeholder="e.g. Thermo Fisher" value={form.supplier} onChange={e => set('supplier', e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">Vendor</label>
                <input className="form-input" placeholder="e.g. Thermo Fisher Scientific" value={form.vendor} onChange={e => set('vendor', e.target.value)} />
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Unit Cost ($)</label>
                <input className="form-input" type="number" step="0.01" min="0" value={form.unitCost} onChange={e => set('unitCost', e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">Reorder Point</label>
                <input className="form-input" type="number" min="0" value={form.reorderPoint} onChange={e => set('reorderPoint', e.target.value)} />
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Reference Number</label>
                <input className="form-input" placeholder="e.g. PO-2026-0050" value={form.referenceNumber} onChange={e => set('referenceNumber', e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">Initial Quantity</label>
                <input className="form-input" type="number" min="0" value={form.quantity} onChange={e => set('quantity', e.target.value)} />
              </div>
            </div>

            {parseInt(form.quantity, 10) > 0 && (
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Lot Number</label>
                  <input className="form-input" placeholder="e.g. TF-24B220" value={form.lotNumber} onChange={e => set('lotNumber', e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Expiration Date</label>
                  <input className="form-input" type="date" value={form.expirationDate} onChange={e => set('expirationDate', e.target.value)} />
                </div>
              </div>
            )}

            <div className="btn-group" style={{ justifyContent: 'flex-end', gap: '12px' }}>
              <button type="button" className="btn btn-secondary" onClick={() => navigate('/inventory')}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={!form.sku || !form.name}>Create Item</button>
            </div>
          </div>
        </div>
      </form>

      {toast && <div className="toast toast--success">{toast}</div>}
    </main>
  );
}
