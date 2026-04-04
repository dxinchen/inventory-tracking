import { useState } from 'react';
import { mockItems, mockTransactions, getItemName, getItemSku } from '../mock/data';

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
  const [format, setFormat] = useState<Format>('csv');
  const [toast, setToast] = useState('');

  function exportInventory() {
    const headers = ['SKU', 'Name', 'Quantity', 'Location', 'Category', 'Supplier', 'Vendor', 'Reference Number', 'Unit Cost', 'Reorder Point', 'Expiration Date'];
    const rows = mockItems.map(i => [
      i.sku, i.name, String(i.quantity), i.location, i.category,
      i.supplier, i.vendor, i.referenceNumber, i.unitCost.toFixed(2), String(i.reorderPoint), i.expirationDate || 'N/A',
    ]);
    downloadCSV(`inventory_${new Date().toISOString().slice(0, 10)}.csv`, headers, rows);
    setToast('Inventory exported');
    setTimeout(() => setToast(''), 3000);
  }

  function exportTransactions() {
    const headers = ['ID', 'Type', 'Item SKU', 'Item Name', 'Quantity', 'Note', 'Performed By', 'Timestamp'];
    const rows = mockTransactions.map(t => [
      t.id, t.type, getItemSku(t.itemId), getItemName(t.itemId),
      String((t.data.quantity as number) ?? ''), (t.data.note as string) ?? '',
      t.performedBy, t.timestamp,
    ]);
    downloadCSV(`transactions_${new Date().toISOString().slice(0, 10)}.csv`, headers, rows);
    setToast('Transactions exported');
    setTimeout(() => setToast(''), 3000);
  }

  return (
    <main className="page">
      <div className="page-header">
        <h1 className="page-title">Export</h1>
        <span className="page-subtitle">Download inventory and transaction data</span>
      </div>

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
            Export all {mockItems.length} items with quantities, locations, costs, and reorder points.
          </div>
          <button className="btn btn-primary" onClick={exportInventory}>
            Download Inventory
          </button>
        </div>

        <div className="action-card" style={{ animation: 'cardIn 0.4s ease-out 0.1s both' }}>
          <div className="action-card__icon">{'\u{1F4CB}'}</div>
          <div className="action-card__title">Transaction Log</div>
          <div className="action-card__desc">
            Export all {mockTransactions.length} transaction records with timestamps and audit trail.
          </div>
          <button className="btn btn-primary" onClick={exportTransactions}>
            Download Transactions
          </button>
        </div>

        <div className="action-card" style={{ animation: 'cardIn 0.4s ease-out 0.15s both' }}>
          <div className="action-card__icon">{'\u{1F4C4}'}</div>
          <div className="action-card__title">CSV Template</div>
          <div className="action-card__desc">
            Download a blank CSV template for bulk importing new inventory items.
          </div>
          <button className="btn btn-secondary" onClick={() => {
            downloadCSV('import_template.csv', ['SKU', 'Name', 'Quantity', 'Location', 'Category', 'Supplier', 'Unit Cost', 'Reorder Point', 'Expiration Date'], []);
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
