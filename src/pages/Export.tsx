import { useState } from 'react';
import { useInventory } from '../context/InventoryContext';

type Format = 'csv' | 'xlsx';

function downloadCSV(filename: string, headers: string[], rows: string[][]) {
  const csv = [headers, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function Export() {
  const { items, transactions, orders, loading, error } = useInventory();
  const [format, setFormat] = useState<Format>('csv');
  const [toast, setToast] = useState('');

  const itemNameById = new Map(items.map((i) => [i.id, i.name]));
  const itemSkuById = new Map(items.map((i) => [i.id, i.sku]));
  const orderPoById = new Map(orders.map((o) => [o.id, o.poNumber]));

  function exportInventory() {
    const headers = ['SKU', 'Name', 'Quantity', 'Location', 'Category', 'Supplier', 'Vendor', 'Reference Number', 'Unit Cost', 'Reorder Point', 'Unit of Measure', 'Expiration Date'];
    const rows = items.map(i => [
      i.sku, i.name, String(i.quantity), i.location, i.category,
      i.supplier, i.vendor, i.referenceNumber, i.unitCost != null ? i.unitCost.toFixed(2) : '', String(i.reorderPoint), i.unitOfMeasure, i.earliestExpiration || 'N/A',
    ]);
    downloadCSV(`inventory_${new Date().toISOString().slice(0, 10)}.csv`, headers, rows);
    setToast('Inventory exported');
    setTimeout(() => setToast(''), 3000);
  }

  function exportTransactions() {
    const headers = ['ID', 'Type', 'Item ID', 'Item SKU', 'Item Name', 'PO Number', 'Quantity', 'Note', 'Performed By', 'Timestamp'];
    const rows = transactions.map(t => {
      // For order-* tx, itemId is the order id; for others, it's the inventory item id.
      const isOrderTx = t.type === 'order-create' || t.type === 'order-receive' || t.type === 'order-cancel';
      const sku = isOrderTx ? '' : (itemSkuById.get(t.itemId) ?? '');
      const name = isOrderTx ? '' : (itemNameById.get(t.itemId) ?? '');
      const po = isOrderTx ? (orderPoById.get(t.itemId) ?? '') : '';
      const data = t.data as Record<string, unknown>;
      return [
        t.id, t.type, t.itemId, sku, name, po,
        String(data.quantity ?? ''), String(data.note ?? ''),
        t.performedBy, t.timestamp,
      ];
    });
    downloadCSV(`transactions_${new Date().toISOString().slice(0, 10)}.csv`, headers, rows);
    setToast('Transactions exported');
    setTimeout(() => setToast(''), 3000);
  }

  function exportOrders() {
    const headers = ['PO Number', 'Status', 'Supplier', 'Order Date', 'Expected', 'Received', 'Line ID', 'Item ID', 'Item Name', 'UoM', 'Qty Ordered', 'Qty Received', 'Unit Cost', 'Lot', 'Expiration'];
    const rows: string[][] = [];
    for (const o of orders) {
      for (const l of o.lineItems) {
        rows.push([
          o.poNumber, o.status, o.supplier, o.orderDate,
          o.expectedDeliveryDate ?? '', o.actualReceiveDate ?? '',
          l.id, l.itemId, l.name, l.unitOfMeasure,
          String(l.quantityOrdered),
          l.quantityReceived != null ? String(l.quantityReceived) : '',
          l.unitCost != null ? l.unitCost.toFixed(2) : '',
          l.lotNumber ?? '', l.expirationDate ?? '',
        ]);
      }
    }
    downloadCSV(`orders_${new Date().toISOString().slice(0, 10)}.csv`, headers, rows);
    setToast('Orders exported');
    setTimeout(() => setToast(''), 3000);
  }

  const exportsDisabled = loading || error !== null;

  return (
    <main className="page">
      <div className="page-header">
        <h1 className="page-title">Export</h1>
        <span className="page-subtitle">Download inventory and transaction data</span>
      </div>

      {loading && (
        <div className="form-hint" style={{ marginBottom: '16px' }}>Loading live data…</div>
      )}
      {error && (
        <div className="toast toast--error" style={{ marginBottom: '16px' }}>
          Failed to load live data: {error.message}
        </div>
      )}

      <div className="toolbar" style={{ marginBottom: '24px' }}>
        <label className="form-label" style={{ margin: 0, alignSelf: 'center' }}>Format</label>
        <div className="toggle-group">
          <button className={`toggle-option ${format === 'csv' ? 'active' : ''}`} onClick={() => setFormat('csv')}>
            CSV
          </button>
          <button className={`toggle-option ${format === 'xlsx' ? 'active' : ''}`} onClick={() => setFormat('xlsx')}>
            XLSX
          </button>
        </div>
        {format === 'xlsx' && (
          <span className="form-hint" style={{ alignSelf: 'center' }}>XLSX requires xlsx library — CSV used as fallback</span>
        )}
      </div>

      <div className="action-cards">
        <div className="action-card" style={{ animation: 'cardIn 0.4s ease-out 0.05s both' }}>
          <div className="action-card__icon">{'\u{1F4E6}'}</div>
          <div className="action-card__title">Current Inventory</div>
          <div className="action-card__desc">
            Export all {items.length} items with quantities, locations, costs, and reorder points.
          </div>
          <button className="btn btn-primary" onClick={exportInventory} disabled={exportsDisabled}>
            Download Inventory
          </button>
        </div>

        <div className="action-card" style={{ animation: 'cardIn 0.4s ease-out 0.1s both' }}>
          <div className="action-card__icon">{'\u{1F4CB}'}</div>
          <div className="action-card__title">Transaction Log</div>
          <div className="action-card__desc">
            Export all {transactions.length} transaction records with timestamps and audit trail.
          </div>
          <button className="btn btn-primary" onClick={exportTransactions} disabled={exportsDisabled}>
            Download Transactions
          </button>
        </div>

        <div className="action-card" style={{ animation: 'cardIn 0.4s ease-out 0.15s both' }}>
          <div className="action-card__icon">{'\u{1F4DD}'}</div>
          <div className="action-card__title">Purchase Orders</div>
          <div className="action-card__desc">
            Export all {orders.length} purchase orders, expanded one row per line item.
          </div>
          <button className="btn btn-primary" onClick={exportOrders} disabled={exportsDisabled}>
            Download Orders
          </button>
        </div>

        <div className="action-card" style={{ animation: 'cardIn 0.4s ease-out 0.2s both' }}>
          <div className="action-card__icon">{'\u{1F4C4}'}</div>
          <div className="action-card__title">CSV Template</div>
          <div className="action-card__desc">
            Download a blank CSV template for bulk importing new inventory items.
          </div>
          <button className="btn btn-secondary" onClick={() => {
            downloadCSV('import_template.csv', ['SKU', 'Name', 'Quantity', 'Location', 'Category', 'Supplier', 'Unit Cost', 'Reorder Point', 'Unit of Measure', 'Expiration Date'], []);
            setToast('Template downloaded');
            setTimeout(() => setToast(''), 3000);
          }}>
            Download Template
          </button>
        </div>
      </div>

      {toast && <div className="toast toast--success">{toast}</div>}
    </main>
  );
}
