import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useInventory } from '../context/InventoryContext';
import { ORDER_STATUS_DISPLAY, type Order, type OrderStatus } from '../models/order';

function lineTotal(order: Order): number {
  return order.lineItems.reduce((sum, l) => sum + l.unitCost * l.quantityOrdered, 0);
}

export default function OrdersList() {
  const { orders } = useInventory();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'' | OrderStatus>('');
  const [supplierFilter, setSupplierFilter] = useState('');

  const suppliers = useMemo(
    () => [...new Set(orders.map((o) => o.supplier))].sort(),
    [orders],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return orders
      .filter((o) => {
        if (q && !o.poNumber.toLowerCase().includes(q) && !o.orderConfirmationNumber.toLowerCase().includes(q)) return false;
        if (statusFilter && o.status !== statusFilter) return false;
        if (supplierFilter && o.supplier !== supplierFilter) return false;
        return true;
      })
      .sort((a, b) => b.orderDate.localeCompare(a.orderDate));
  }, [orders, search, statusFilter, supplierFilter]);

  return (
    <main className="page">
      <div className="page-header">
        <h1 className="page-title">Orders</h1>
        <span className="page-subtitle">{filtered.length} of {orders.length} purchase orders</span>
      </div>

      <div className="toolbar">
        <div className="search-bar">
          <input
            type="text"
            className="form-input"
            placeholder="Search PO# or confirmation #..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select
          className="form-select"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as '' | OrderStatus)}
        >
          <option value="">All Status</option>
          <option value="placed">Placed</option>
          <option value="received">Received</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <select
          className="form-select"
          value={supplierFilter}
          onChange={(e) => setSupplierFilter(e.target.value)}
        >
          <option value="">All Suppliers</option>
          {suppliers.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        {(search || statusFilter || supplierFilter) && (
          <button className="btn btn-secondary" onClick={() => { setSearch(''); setStatusFilter(''); setSupplierFilter(''); }}>
            Clear
          </button>
        )}
        <div className="toolbar-spacer" />
        <button className="btn btn-primary" onClick={() => navigate('/orders/new')}>
          + New Order
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state__icon">📋</div>
          <p className="empty-state__title">No orders match your filters</p>
          <p className="empty-state__text">{orders.length === 0 ? 'Create your first purchase order to get started.' : 'Try clearing the filters above.'}</p>
          {orders.length === 0 && (
            <button className="btn btn-primary" onClick={() => navigate('/orders/new')}>
              + Create your first order
            </button>
          )}
        </div>
      ) : (
        <div className="panel" style={{ animationDelay: '0.1s' }}>
          <div className="panel__body">
            <table className="data-table">
              <thead>
                <tr>
                  <th>PO #</th>
                  <th>Supplier</th>
                  <th>Order Date</th>
                  <th>Expected</th>
                  <th>Status</th>
                  <th>Lines</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((o) => (
                  <tr key={o.id} onClick={() => navigate(`/orders/${o.id}`)} style={{ cursor: 'pointer' }}>
                    <td className="cell-sku">{o.poNumber}</td>
                    <td>{o.supplier}</td>
                    <td className="cell-mono">{o.orderDate}</td>
                    <td className="cell-mono">{o.expectedDeliveryDate ?? '—'}</td>
                    <td><span className={`badge badge--${ORDER_STATUS_DISPLAY[o.status].badge}`}>{ORDER_STATUS_DISPLAY[o.status].label}</span></td>
                    <td className="cell-mono">{o.lineItems.length}</td>
                    <td className="cell-mono">${lineTotal(o).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </main>
  );
}
