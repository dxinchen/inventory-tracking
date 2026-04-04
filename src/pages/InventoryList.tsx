import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useInventory } from '../context/InventoryContext';
import type { InventoryItem } from '../models/inventory';

type SortKey = 'sku' | 'name' | 'quantity' | 'location' | 'category' | 'supplier' | 'unitCost';
type SortDir = 'asc' | 'desc';

function getStatus(item: InventoryItem): 'out' | 'low' | 'expiring' | 'ok' {
  if (item.quantity === 0) return 'out';
  if (item.quantity <= item.reorderPoint) return 'low';
  if (item.earliestExpiration) {
    const now = new Date();
    const exp = new Date(item.earliestExpiration);
    const days = Math.ceil((exp.getTime() - now.getTime()) / 86400000);
    if (days >= 0 && days <= 30) return 'expiring';
  }
  return 'ok';
}

const statusLabel: Record<string, string> = {
  out: 'Out of Stock', low: 'Low', expiring: 'Expiring', ok: 'OK',
};

const statusBadge: Record<string, string> = {
  out: 'critical', low: 'low', expiring: 'expiring', ok: 'ok',
};

export default function InventoryList() {
  const { items } = useInventory();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('sku');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  const categories = useMemo(() => [...new Set(items.map(i => i.category))].sort(), [items]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return items
      .filter(item => {
        if (q && !item.sku.toLowerCase().includes(q) && !item.name.toLowerCase().includes(q) && !item.supplier.toLowerCase().includes(q)) return false;
        if (categoryFilter && item.category !== categoryFilter) return false;
        if (statusFilter && getStatus(item) !== statusFilter) return false;
        return true;
      })
      .sort((a, b) => {
        const aVal = a[sortKey];
        const bVal = b[sortKey];
        const cmp = typeof aVal === 'number' ? aVal - (bVal as number) : String(aVal).localeCompare(String(bVal));
        return sortDir === 'asc' ? cmp : -cmp;
      });
  }, [items, search, categoryFilter, statusFilter, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  }

  function SortHeader({ label, field }: { label: string; field: SortKey }) {
    const active = sortKey === field;
    return (
      <th className="sortable" onClick={() => toggleSort(field)}>
        {label}
        <span className={`sort-arrow ${active ? 'active' : ''}`}>
          {active ? (sortDir === 'asc' ? '\u25B2' : '\u25BC') : '\u25B2'}
        </span>
      </th>
    );
  }

  if (items.length === 0) {
    return (
      <main className="page">
        <div className="page-header">
          <h1 className="page-title">Inventory</h1>
          <span className="page-subtitle">0 items</span>
        </div>
        <div className="empty-state">
          <div className="empty-state__icon">&#x1F4E6;</div>
          <p className="empty-state__title">No items yet</p>
          <p className="empty-state__text">Start building your inventory by adding your first item.</p>
          <button className="btn btn-primary" onClick={() => navigate('/inventory/new')}>
            + Create your first item
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="page">
      <div className="page-header">
        <h1 className="page-title">Inventory</h1>
        <span className="page-subtitle">{filtered.length} of {items.length} items</span>
      </div>

      <div className="toolbar">
        <div className="search-bar">
          <input
            type="text"
            className="form-input"
            placeholder="Search SKU, name, supplier..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <select className="form-select" value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}>
          <option value="">All Categories</option>
          {categories.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select className="form-select" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="">All Status</option>
          <option value="ok">OK</option>
          <option value="low">Low Stock</option>
          <option value="out">Out of Stock</option>
          <option value="expiring">Expiring</option>
        </select>
        {(search || categoryFilter || statusFilter) && (
          <button className="btn btn-secondary" onClick={() => { setSearch(''); setCategoryFilter(''); setStatusFilter(''); }}>
            Clear
          </button>
        )}
        <div className="toolbar-spacer" />
        <button className="btn btn-primary" onClick={() => navigate('/inventory/new')}>
          + New Item
        </button>
      </div>

      <div className="panel" style={{ animationDelay: '0.1s' }}>
        <div className="panel__body">
          <table className="data-table">
            <thead>
              <tr>
                <SortHeader label="SKU" field="sku" />
                <SortHeader label="Name" field="name" />
                <SortHeader label="Qty" field="quantity" />
                <SortHeader label="Location" field="location" />
                <SortHeader label="Category" field="category" />
                <SortHeader label="Supplier" field="supplier" />
                <th>Vendor</th>
                <th>Ref #</th>
                <SortHeader label="Unit Cost" field="unitCost" />
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(item => {
                const status = getStatus(item);
                return (
                  <tr key={item.id} onClick={() => navigate(`/inventory/${item.id}`)} style={{ cursor: 'pointer' }}>
                    <td className="cell-sku">{item.sku}</td>
                    <td className="cell-name">{item.name}</td>
                    <td className={`cell-qty cell-qty--${statusBadge[status]}`}>{item.quantity}</td>
                    <td className="cell-mono">{item.location}</td>
                    <td>{item.category}</td>
                    <td>{item.supplier}</td>
                    <td>{item.vendor}</td>
                    <td className="cell-mono">{item.referenceNumber}</td>
                    <td className="cell-mono">{item.unitCost != null ? `$${item.unitCost.toFixed(2)}` : '—'}</td>
                    <td>
                      <span className={`badge badge--${statusBadge[status]}`}>{statusLabel[status]}</span>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={10} style={{ textAlign: 'center', padding: '32px', color: 'var(--text-muted)' }}>
                    No items match your filters
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}
