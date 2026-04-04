import { useNavigate } from 'react-router-dom';
import {
  timeAgo,
  daysUntil,
  getFirstName,
} from '../mock/data';
import { useInventory } from '../context/InventoryContext';
import type { InventoryItem } from '../models/inventory';
import type { StockData } from '../models/transaction';

function SummaryCards({ items }: { items: InventoryItem[] }) {
  const totalItems = items.length;
  const totalUnits = items.reduce((s, i) => s + i.quantity, 0);
  const lowStock = items.filter(i => i.quantity <= i.reorderPoint);
  const expiring = items.filter(i => {
    if (!i.earliestExpiration) return false;
    const days = daysUntil(i.earliestExpiration);
    return days >= 0 && days <= 30;
  });

  return (
    <div className="summary-row" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
      <div className="summary-card">
        <div className="summary-card__label">Total Products</div>
        <div className="summary-card__value">{totalItems}</div>
        <div className="summary-card__detail">
          {totalUnits.toLocaleString()} units in stock
        </div>
      </div>

      <div className={`summary-card ${lowStock.length > 0 ? 'summary-card--warning' : ''}`}>
        <div className="summary-card__label">Low Stock Alerts</div>
        <div className={`summary-card__value ${lowStock.length > 0 ? 'summary-card__value--warning' : ''}`}>
          {lowStock.length}
        </div>
        <div className="summary-card__detail">
          {lowStock.filter(i => i.quantity === 0).length > 0
            ? `${lowStock.filter(i => i.quantity === 0).length} out of stock`
            : 'items at or below reorder point'}
        </div>
      </div>

      <div className={`summary-card ${expiring.length > 0 ? 'summary-card--info' : ''}`}>
        <div className="summary-card__label">Expiring Soon</div>
        <div className="summary-card__value">{expiring.length}</div>
        <div className="summary-card__detail">within next 30 days</div>
      </div>
    </div>
  );
}

function LowStockTable({ items }: { items: InventoryItem[] }) {
  const navigate = useNavigate();
  const lowItems = items.filter(i => i.quantity <= i.reorderPoint).sort((a, b) => a.quantity - b.quantity);

  return (
    <div className="panel" style={{ animationDelay: '0.25s' }}>
      <div className="panel__header">
        <span className="panel__title">
          <span className="panel__title-dot" style={{ background: 'var(--low)' }} />
          Low Stock Alerts
        </span>
        <span className="panel__count">{lowItems.length} items</span>
      </div>
      <div className="panel__body">
        <table className="data-table">
          <thead>
            <tr>
              <th>SKU</th>
              <th>Name</th>
              <th>Qty</th>
              <th>Reorder Pt</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {lowItems.map(item => {
              const isCritical = item.quantity === 0;
              const statusClass = isCritical ? 'critical' : 'low';
              return (
                <tr key={item.id} onClick={() => navigate(`/inventory/${item.id}`)} style={{ cursor: 'pointer' }}>
                  <td className="cell-sku">{item.sku}</td>
                  <td className="cell-name">{item.name}</td>
                  <td className={`cell-qty cell-qty--${statusClass}`}>{item.quantity}</td>
                  <td className="cell-mono">{item.reorderPoint}</td>
                  <td>
                    <span className={`badge badge--${statusClass}`}>
                      {isCritical ? 'Out of Stock' : 'Low'}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ActivityFeed() {
  const { transactions, items } = useInventory();
  const recent = [...transactions].reverse().slice(0, 10);

  const typeConfig: Record<string, { icon: string; iconClass: string }> = {
    'stock-in': { icon: '\u2193', iconClass: 'in' },
    'stock-out': { icon: '\u2191', iconClass: 'out' },
    'item-create': { icon: '+', iconClass: 'create' },
    'item-update': { icon: '\u270E', iconClass: 'update' },
    'item-delete': { icon: '\u2715', iconClass: 'out' },
  };

  function getItemInfo(itemId: string) {
    const item = items.find(i => i.id === itemId);
    return { name: item?.name ?? 'Deleted Item', sku: item?.sku ?? '???' };
  }

  function renderText(tx: typeof recent[0]) {
    const { name, sku } = getItemInfo(tx.itemId);
    const qty = (tx.data as StockData).quantity;
    const note = (tx.data as StockData).note as string | undefined;

    switch (tx.type) {
      case 'stock-in':
        return (
          <>
            Received <span className="qty-change qty-change--plus">+{qty}</span>{' '}
            <strong>{name}</strong> <span className="cell-sku" style={{ fontSize: '0.65rem' }}>({sku})</span>
            {note && <> — {note}</>}
          </>
        );
      case 'stock-out':
        return (
          <>
            Used <span className="qty-change qty-change--minus">-{qty}</span>{' '}
            <strong>{name}</strong> <span className="cell-sku" style={{ fontSize: '0.65rem' }}>({sku})</span>
            {note && <> — {note}</>}
          </>
        );
      case 'item-create':
        return (
          <>
            Created new item <strong>{name}</strong>{' '}
            <span className="cell-sku" style={{ fontSize: '0.65rem' }}>({sku})</span>
          </>
        );
      case 'item-update':
        return (
          <>
            Updated <strong>{name}</strong>{' '}
            <span className="cell-sku" style={{ fontSize: '0.65rem' }}>({sku})</span>
            {note && <> — {note}</>}
          </>
        );
      case 'item-delete':
        return (
          <>
            Deleted <strong>{name}</strong>{' '}
            <span className="cell-sku" style={{ fontSize: '0.65rem' }}>({sku})</span>
          </>
        );
      default:
        return <>Unknown action</>;
    }
  }

  return (
    <div className="panel" style={{ animationDelay: '0.3s' }}>
      <div className="panel__header">
        <span className="panel__title">
          <span className="panel__title-dot" />
          Recent Activity
        </span>
        <span className="panel__count">{recent.length} entries</span>
      </div>
      <div className="panel__body">
        {recent.length === 0 ? (
          <div className="empty-state empty-state--inline">
            <p className="empty-state__text">No activity yet</p>
          </div>
        ) : (
          <ul className="activity-list">
            {recent.map(tx => {
              const cfg = typeConfig[tx.type] ?? typeConfig['item-create'];
              return (
                <li key={tx.id} className="activity-item">
                  <div className={`activity-icon activity-icon--${cfg.iconClass}`}>
                    {cfg.icon}
                  </div>
                  <div className="activity-content">
                    <div className="activity-text">{renderText(tx)}</div>
                    <div className="activity-meta">
                      <span>{getFirstName(tx.performedBy)}</span>
                      <span>{timeAgo(tx.timestamp)}</span>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

interface ExpiringBatchRow {
  itemId: string;
  sku: string;
  name: string;
  location: string;
  lotNumber: string;
  batchQty: number;
  expirationDate: string;
  days: number;
}

function ExpiringTable({ items }: { items: InventoryItem[] }) {
  const navigate = useNavigate();
  // Flatten: one row per expiring batch, not per item
  const rows: ExpiringBatchRow[] = [];
  for (const item of items) {
    for (const batch of item.batches) {
      if (!batch.expirationDate || batch.quantity <= 0) continue;
      const days = daysUntil(batch.expirationDate);
      if (days >= 0 && days <= 30) {
        rows.push({
          itemId: item.id,
          sku: item.sku,
          name: item.name,
          location: item.location,
          lotNumber: batch.lotNumber,
          batchQty: batch.quantity,
          expirationDate: batch.expirationDate,
          days,
        });
      }
    }
  }
  rows.sort((a, b) => a.days - b.days);

  if (rows.length === 0) return null;

  return (
    <div className="panel" style={{ animationDelay: '0.3s' }}>
      <div className="panel__header">
        <span className="panel__title">
          <span className="panel__title-dot" style={{ background: 'var(--expiring)' }} />
          Expiring Soon
        </span>
        <span className="panel__count">{rows.length} batches</span>
      </div>
      <div className="panel__body">
        <table className="data-table">
          <thead>
            <tr>
              <th>SKU</th>
              <th>Name</th>
              <th>Lot #</th>
              <th>Batch Qty</th>
              <th>Location</th>
              <th>Expires</th>
              <th>Days Left</th>
              <th>Urgency</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(row => {
              const urgency = row.days <= 7 ? 'urgent' : row.days <= 14 ? 'soon' : 'ok';
              const barWidth = Math.max(5, Math.min(100, (1 - row.days / 30) * 100));
              return (
                <tr key={`${row.itemId}-${row.lotNumber}`} onClick={() => navigate(`/inventory/${row.itemId}`)} style={{ cursor: 'pointer' }}>
                  <td className="cell-sku">{row.sku}</td>
                  <td className="cell-name">{row.name}</td>
                  <td className="cell-mono" style={{ fontSize: '0.68rem' }}>{row.lotNumber}</td>
                  <td className="cell-mono">{row.batchQty}</td>
                  <td className="cell-mono">{row.location}</td>
                  <td className="cell-mono">{new Date(row.expirationDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</td>
                  <td>
                    <span className={`badge badge--${urgency === 'urgent' ? 'critical' : urgency === 'soon' ? 'low' : 'ok'}`}>
                      {row.days}d
                    </span>
                  </td>
                  <td>
                    <div className="expiry-bar-wrap">
                      <div
                        className={`expiry-bar expiry-bar--${urgency}`}
                        style={{ width: `${barWidth}%` }}
                      />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { items } = useInventory();

  return (
    <main className="page">
      <div className="page-header">
        <h1 className="page-title">Dashboard</h1>
        <span className="page-subtitle">Last synced: just now</span>
      </div>

      <SummaryCards items={items} />

      <div className="dashboard-grid">
        <LowStockTable items={items} />
        <ActivityFeed />
      </div>

      <div className="dashboard-grid" style={{ gridTemplateColumns: '1fr' }}>
        <ExpiringTable items={items} />
      </div>
    </main>
  );
}
