import {
  mockItems,
  mockTransactions,
  getLowStockItems,
  getExpiringItems,
  getTotalValue,
  formatCurrency,
  formatCurrencyFull,
  timeAgo,
  daysUntil,
  getItemName,
  getItemSku,
  getFirstName,
} from '../mock/data';

function SummaryCards() {
  const totalItems = mockItems.length;
  const totalValue = getTotalValue();
  const lowStock = getLowStockItems();
  const expiring = getExpiringItems();

  return (
    <div className="summary-row">
      <div className="summary-card">
        <div className="summary-card__label">Total Products</div>
        <div className="summary-card__value">{totalItems}</div>
        <div className="summary-card__detail">
          {mockItems.reduce((s, i) => s + i.quantity, 0).toLocaleString()} units in stock
        </div>
      </div>

      <div className="summary-card summary-card--ok">
        <div className="summary-card__label">Inventory Value</div>
        <div className="summary-card__value">{formatCurrency(totalValue)}</div>
        <div className="summary-card__detail">{formatCurrencyFull(totalValue)}</div>
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

function LowStockTable() {
  const lowItems = getLowStockItems().sort((a, b) => a.quantity - b.quantity);

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
                <tr key={item.id}>
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
  const recent = mockTransactions.slice(0, 10);

  const typeConfig: Record<string, { icon: string; iconClass: string }> = {
    'stock-in': { icon: '\u2193', iconClass: 'in' },
    'stock-out': { icon: '\u2191', iconClass: 'out' },
    'item-create': { icon: '+', iconClass: 'create' },
    'item-update': { icon: '\u270E', iconClass: 'update' },
    'item-delete': { icon: '\u2715', iconClass: 'out' },
  };

  function renderText(tx: typeof recent[0]) {
    const name = getItemName(tx.itemId);
    const sku = getItemSku(tx.itemId);
    const qty = tx.data.quantity as number | undefined;
    const note = tx.data.note as string | undefined;

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
      </div>
    </div>
  );
}

function ExpiringTable() {
  const expiring = getExpiringItems().sort((a, b) => daysUntil(a.expirationDate) - daysUntil(b.expirationDate));

  if (expiring.length === 0) return null;

  return (
    <div className="panel" style={{ animationDelay: '0.3s' }}>
      <div className="panel__header">
        <span className="panel__title">
          <span className="panel__title-dot" style={{ background: 'var(--expiring)' }} />
          Expiring Soon
        </span>
        <span className="panel__count">{expiring.length} items</span>
      </div>
      <div className="panel__body">
        <table className="data-table">
          <thead>
            <tr>
              <th>SKU</th>
              <th>Name</th>
              <th>Location</th>
              <th>Qty</th>
              <th>Expires</th>
              <th>Days Left</th>
              <th>Urgency</th>
            </tr>
          </thead>
          <tbody>
            {expiring.map(item => {
              const days = daysUntil(item.expirationDate);
              const urgency = days <= 7 ? 'urgent' : days <= 14 ? 'soon' : 'ok';
              const barWidth = Math.max(5, Math.min(100, (1 - days / 30) * 100));
              return (
                <tr key={item.id}>
                  <td className="cell-sku">{item.sku}</td>
                  <td className="cell-name">{item.name}</td>
                  <td className="cell-mono">{item.location}</td>
                  <td className="cell-mono">{item.quantity}</td>
                  <td className="cell-mono">{new Date(item.expirationDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</td>
                  <td>
                    <span className={`badge badge--${urgency === 'urgent' ? 'critical' : urgency === 'soon' ? 'low' : 'ok'}`}>
                      {days}d
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
  return (
    <main className="page">
      <div className="page-header">
        <h1 className="page-title">Dashboard</h1>
        <span className="page-subtitle">Last synced: just now</span>
      </div>

      <SummaryCards />

      <div className="dashboard-grid">
        <LowStockTable />
        <ExpiringTable />
      </div>

      <div className="dashboard-grid" style={{ gridTemplateColumns: '1fr' }}>
        <ActivityFeed />
      </div>
    </main>
  );
}
