import { useState, useRef } from 'react';
import { useInventory } from '../context/InventoryContext';

interface ParsedRow {
  sku: string;
  name: string;
  quantity: string;
  location: string;
  category: string;
  supplier: string;
  unitCost: string;
  reorderPoint: string;
  vendor: string;
  referenceNumber: string;
  expirationDate: string;
  unitOfMeasure: string;
  status: 'new' | 'exists';
}

function parseCSV(text: string): Omit<ParsedRow, 'status'>[] {
  const lines = text.trim().split('\n');
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map(h => h.replace(/"/g, '').trim().toLowerCase());

  return lines.slice(1).map(line => {
    const values: string[] = [];
    let current = '';
    let inQuotes = false;
    for (const char of line) {
      if (char === '"') { inQuotes = !inQuotes; continue; }
      if (char === ',' && !inQuotes) { values.push(current.trim()); current = ''; continue; }
      current += char;
    }
    values.push(current.trim());

    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = values[i] || ''; });

    return {
      sku: row['sku'] || '',
      name: row['name'] || '',
      quantity: row['quantity'] || '0',
      location: row['location'] || '',
      category: row['category'] || '',
      supplier: row['supplier'] || '',
      unitCost: row['unit cost'] || row['unitcost'] || '',
      reorderPoint: row['reorder point'] || row['reorderpoint'] || '0',
      vendor: row['vendor'] || '',
      referenceNumber: row['reference number'] || row['referencenumber'] || row['ref #'] || '',
      expirationDate: row['expiration date'] || row['expirationdate'] || '',
      unitOfMeasure: row['unit of measure'] || row['unitofmeasure'] || row['uom'] || '',
    };
  }).filter(r => r.sku || r.name);
}

export default function Import() {
  const { items, isAdmin, addItem, updateItem } = useInventory();
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [fileName, setFileName] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [overwrite, setOverwrite] = useState(false);
  const [showOverwriteWarning, setShowOverwriteWarning] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  if (!isAdmin) {
    return (
      <main className="page">
        <div className="placeholder-page">
          <div className="placeholder-icon">{'\u{1F512}'}</div>
          <div className="placeholder-text">
            <strong>Admin Only</strong>
            Bulk CSV import is restricted to administrators. Contact your Azure AD admin for access.
          </div>
        </div>
      </main>
    );
  }

  const handleFile = (file: File) => {
    if (!file.name.endsWith('.csv')) {
      setToast({ type: 'error', msg: 'Only CSV files are supported' });
      setTimeout(() => setToast(null), 3000);
      return;
    }
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const parsed = parseCSV(text);
      const existingSkus = new Set(items.map(i => i.sku.toLowerCase()));
      const tagged: ParsedRow[] = parsed.map(r => ({
        ...r,
        status: existingSkus.has(r.sku.toLowerCase()) ? 'exists' : 'new',
      }));
      setRows(tagged);
      if (tagged.length === 0) {
        setToast({ type: 'error', msg: 'No valid rows found in file' });
        setTimeout(() => setToast(null), 3000);
      }
    };
    reader.readAsText(file);
  };

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }

  async function handleImport() {
    if (importing) return;
    setImporting(true);
    const existingBySku = new Map(items.map(i => [i.sku.toLowerCase(), i]));
    let created = 0;
    let updated = 0;
    let skipped = 0;
    let failed = 0;

    try {
      for (const row of rows) {
        if (!row.sku || !row.name) continue;

        try {
          const existing = existingBySku.get(row.sku.toLowerCase());
          if (existing) {
            if (overwrite) {
              await updateItem(existing.id, {
                name: row.name,
                location: row.location,
                category: row.category,
                supplier: row.supplier,
                unitCost: row.unitCost ? parseFloat(row.unitCost) : undefined,
                reorderPoint: parseInt(row.reorderPoint, 10) || 0,
                vendor: row.vendor,
                referenceNumber: row.referenceNumber,
                unitOfMeasure: row.unitOfMeasure?.trim() || undefined,
              });
              updated++;
            } else {
              skipped++;
            }
          } else {
            await addItem({
              sku: row.sku,
              name: row.name,
              quantity: parseInt(row.quantity, 10) || 0,
              location: row.location,
              category: row.category,
              supplier: row.supplier,
              unitCost: row.unitCost ? parseFloat(row.unitCost) : undefined,
              reorderPoint: parseInt(row.reorderPoint, 10) || 0,
              vendor: row.vendor,
              referenceNumber: row.referenceNumber,
              expirationDate: row.expirationDate || undefined,
              unitOfMeasure: row.unitOfMeasure || 'each',
            });
            created++;
          }
        } catch {
          failed++;
        }
      }

      const parts = [];
      if (created) parts.push(`${created} created`);
      if (updated) parts.push(`${updated} updated`);
      if (skipped) parts.push(`${skipped} skipped`);
      if (failed) parts.push(`${failed} failed`);
      setToast({ type: failed ? 'error' : 'success', msg: parts.join(', ') });
      setTimeout(() => setToast(null), 4000);
      setRows([]);
      setFileName('');
      setOverwrite(false);
    } finally {
      setImporting(false);
    }
  }

  const newRows = rows.filter(r => r.status === 'new' && r.sku && r.name);
  const existingRows = rows.filter(r => r.status === 'exists');
  const importCount = overwrite ? newRows.length + existingRows.length : newRows.length;

  return (
    <main className="page">
      <div className="page-header">
        <h1 className="page-title">Import</h1>
        <span className="page-subtitle">Bulk import inventory items from CSV (admin only)</span>
      </div>

      {rows.length === 0 ? (
        <div style={{ animation: 'cardIn 0.4s ease-out both' }}>
          <div
            className={`upload-zone ${dragOver ? 'drag-over' : ''}`}
            onClick={() => fileRef.current?.click()}
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
          >
            <div className="upload-zone__icon">{'\u{1F4C1}'}</div>
            <div className="upload-zone__text">
              Drop a CSV file here, or click to browse
            </div>
            <div className="upload-zone__hint">
              Expects columns: SKU, Name, Quantity, Location, Category, Supplier, Vendor, Reference Number, Unit Cost, Reorder Point, Expiration Date, Unit of Measure
            </div>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".csv"
            style={{ display: 'none' }}
            onChange={e => {
              const file = e.target.files?.[0];
              if (file) handleFile(file);
            }}
          />

          <div style={{ marginTop: '24px' }}>
            <div className="action-card" style={{ maxWidth: '480px', animation: 'cardIn 0.4s ease-out 0.1s both' }}>
              <div className="action-card__title">Need a template?</div>
              <div className="action-card__desc">
                Go to the Export page and download the CSV Template to get started with the correct column format.
              </div>
              <a href="/export" className="btn btn-secondary" style={{ width: 'fit-content' }}>
                Go to Export
              </a>
            </div>
          </div>
        </div>
      ) : (
        <div style={{ animation: 'cardIn 0.4s ease-out both' }}>
          {/* File info bar */}
          <div className="toolbar">
            <span className="cell-sku" style={{ fontSize: '0.8rem' }}>{fileName}</span>
            <span className="badge badge--ok">{newRows.length} new</span>
            {existingRows.length > 0 && (
              <span className="badge badge--low">{existingRows.length} already exist</span>
            )}
            <div className="toolbar-spacer" />

            {/* Overwrite toggle */}
            {existingRows.length > 0 && (
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={overwrite}
                  onChange={e => {
                    if (e.target.checked) {
                      setShowOverwriteWarning(true);
                    } else {
                      setOverwrite(false);
                    }
                  }}
                  style={{ accentColor: 'var(--accent)' }}
                />
                <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Overwrite existing</span>
              </label>
            )}

            <button className="btn btn-secondary" onClick={() => { setRows([]); setFileName(''); setOverwrite(false); }}>
              Clear
            </button>
            <button className="btn btn-primary" onClick={handleImport} disabled={importCount === 0 || importing}>
              {importing ? 'Importing...' : `Import ${importCount} Items`}
            </button>
          </div>

          {/* Overwrite warning modal */}
          {showOverwriteWarning && (
            <div style={{
              background: 'var(--critical-bg)',
              border: '1px solid var(--critical-border)',
              borderRadius: 'var(--card-radius)',
              padding: '16px 20px',
              marginBottom: '16px',
              display: 'flex',
              alignItems: 'center',
              gap: '16px',
            }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, color: 'var(--critical)', marginBottom: '4px', fontSize: '0.85rem' }}>
                  Overwrite Warning
                </div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                  Enabling overwrite will update {existingRows.length} existing item(s) with data from the CSV.
                  Fields like name, location, category, supplier, vendor, and cost will be replaced. Quantity and batch history will NOT be affected.
                </div>
              </div>
              <button className="btn btn-danger" onClick={() => { setOverwrite(true); setShowOverwriteWarning(false); }}>
                Enable Overwrite
              </button>
              <button className="btn btn-secondary" onClick={() => setShowOverwriteWarning(false)}>
                Cancel
              </button>
            </div>
          )}

          {/* Preview table */}
          <div className="panel">
            <div className="panel__header">
              <span className="panel__title">
                <span className="panel__title-dot" style={{ background: 'var(--info)' }} />
                Preview
              </span>
              <span className="panel__count">{rows.filter(r => r.sku && r.name).length} items</span>
            </div>
            <div className="panel__body">
              <div className="preview-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Status</th>
                      <th>SKU</th>
                      <th>Name</th>
                      <th>Qty</th>
                      <th>Location</th>
                      <th>Category</th>
                      <th>Supplier</th>
                      <th>Unit Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.filter(r => r.sku && r.name).map((row, i) => (
                      <tr key={i} style={{ opacity: row.status === 'exists' && !overwrite ? 0.4 : 1 }}>
                        <td>
                          {row.status === 'new' ? (
                            <span className="badge badge--ok">New</span>
                          ) : overwrite ? (
                            <span className="badge badge--low">Update</span>
                          ) : (
                            <span className="badge badge--low">Skip</span>
                          )}
                        </td>
                        <td className="cell-sku">{row.sku}</td>
                        <td className="cell-name">{row.name}</td>
                        <td className="cell-mono">{row.quantity}</td>
                        <td className="cell-mono">{row.location}</td>
                        <td>{row.category}</td>
                        <td>{row.supplier}</td>
                        <td className="cell-mono">{row.unitCost ? `$${parseFloat(row.unitCost).toFixed(2)}` : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {toast && <div className={`toast toast--${toast.type}`}>{toast.msg}</div>}
    </main>
  );
}
