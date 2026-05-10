import { useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useInventory } from '../context/InventoryContext';
import { ORDER_STATUS_DISPLAY, type Order, type OrderAttachment } from '../models/order';
import type { InventoryItem } from '../models/inventory';
import type { Transaction, StockData } from '../models/transaction';
import { getOrderAttachmentUrl } from '../api/attachmentService';

export default function OrderDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { orders, loading } = useInventory();

  const order = orders.find((o) => o.id === id);

  // Avoid flashing "Order not found" while the provider is still loading. The
  // child component owns all the hooks, so the early returns here can't cause
  // a hook-order violation across re-renders.
  if (loading) {
    return (
      <main className="page">
        <div className="placeholder-page">
          <div className="placeholder-text">Loading order...</div>
        </div>
      </main>
    );
  }

  if (!order) {
    return (
      <main className="page">
        <div className="placeholder-page">
          <div className="placeholder-icon">🔍</div>
          <div className="placeholder-text">
            <strong>Order not found</strong>
            This PO may have been cancelled or never existed.
          </div>
          <button className="btn btn-secondary" onClick={() => navigate('/orders')}>Back to Orders</button>
        </div>
      </main>
    );
  }

  return <OrderDetailLoaded order={order} />;
}

function OrderDetailLoaded({ order }: { order: Order }) {
  const navigate = useNavigate();
  const { items, transactions, cancelOrder } = useInventory();
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [cancelNote, setCancelNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const total = order.lineItems.reduce((s, l) => s + l.unitCost * l.quantityOrdered, 0);
  const orderId = order.id;

  // Activity timeline: any tx whose itemId matches this order id, PLUS stock-in
  // events whose StockData.orderId points at us (emitted via the receive flow).
  const orderTxs = useMemo<Transaction[]>(() => transactions
    .filter((t) =>
      t.itemId === orderId ||
      (t.type === 'stock-in' && (t.data as StockData).orderId === orderId),
    )
    .reverse(),
  [transactions, orderId]);

  const placedAttachments = useMemo(() => order.attachments.filter((a) => a.stage === 'placed'), [order.attachments]);
  const receivedAttachments = useMemo(() => order.attachments.filter((a) => a.stage === 'received'), [order.attachments]);
  const itemIds = useMemo<Set<string>>(() => new Set((items as InventoryItem[]).map((i) => i.id)), [items]);

  async function handleCancel() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await cancelOrder(order.id, cancelNote.trim() || undefined);
      setConfirmCancel(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  // Open synchronously so the popup blocker treats it as user-initiated, then
  // navigate the new tab once the pre-signed Graph downloadUrl resolves.
  function openAttachment(att: OrderAttachment) {
    const win = window.open('', '_blank');
    if (!win) {
      setError('Popup blocked — allow popups for this site to open attachments.');
      return;
    }
    getOrderAttachmentUrl(order.id, att.filename)
      .then((url) => { win.location.href = url; })
      .catch((err) => {
        win.close();
        setError(`Failed to open ${att.originalFilename}: ${err instanceof Error ? err.message : String(err)}`);
      });
  }

  return (
    <main className="page">
      <div className="page-header" style={{ marginBottom: '16px' }}>
        <h1 className="page-title">PO {order.poNumber}</h1>
        <span className="page-subtitle">Confirmation # {order.orderConfirmationNumber}</span>
      </div>

      <div style={{ display: 'flex', gap: '12px', marginBottom: '24px' }}>
        <button className="btn btn-secondary" onClick={() => navigate('/orders')}>Back</button>
        {order.status === 'placed' && (
          <>
            <button className="btn btn-primary" onClick={() => navigate(`/orders/${order.id}/receive`)}>Receive</button>
            <button className="btn btn-secondary" onClick={() => navigate(`/orders/new?from=${order.id}`)} title="Saving will cancel the original and create a replacement.">
              Edit (cancels original on save)
            </button>
            {!confirmCancel && (
              <button className="btn btn-danger" style={{ marginLeft: 'auto' }} onClick={() => setConfirmCancel(true)} disabled={busy}>
                Cancel Order
              </button>
            )}
          </>
        )}
        {confirmCancel && (
          <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px', alignItems: 'center' }}>
            <input
              type="text"
              className="form-input"
              placeholder="Reason (optional)"
              value={cancelNote}
              onChange={(e) => setCancelNote(e.target.value)}
              style={{ minWidth: '220px' }}
            />
            <button className="btn btn-danger" onClick={handleCancel} disabled={busy}>{busy ? 'Cancelling...' : 'Confirm Cancel'}</button>
            <button className="btn btn-secondary" onClick={() => { setConfirmCancel(false); setCancelNote(''); }} disabled={busy}>Back</button>
          </div>
        )}
      </div>

      {error && (
        <div className="toast toast--error" style={{ position: 'static', marginBottom: '16px' }}>{error}</div>
      )}

      <div className="dashboard-grid" style={{ alignItems: 'start' }}>
        {/* Header info */}
        <div className="panel" style={{ animation: 'cardIn 0.4s ease-out both' }}>
          <div className="panel__header">
            <span className="panel__title">
              <span className="panel__title-dot" />
              Details
            </span>
            <span className={`badge badge--${ORDER_STATUS_DISPLAY[order.status].badge}`}>{ORDER_STATUS_DISPLAY[order.status].label}</span>
          </div>
          <div className="panel__body" style={{ padding: 0 }}>
            <table className="data-table">
              <tbody>
                {([
                  ['PO Number', order.poNumber],
                  ['Confirmation #', order.orderConfirmationNumber],
                  ['Supplier', order.supplier],
                  ['Order Date', order.orderDate],
                  ['Expected Delivery', order.expectedDeliveryDate ?? '—'],
                  ['Actual Receive Date', order.actualReceiveDate ?? '—'],
                  ['Created By', order.createdBy],
                  ['Updated', new Date(order.updatedAt).toLocaleString()],
                  ['Total', `$${total.toFixed(2)}`],
                  ['Note', order.note ?? '—'],
                ] as [string, string][]).map(([label, value]) => (
                  <tr key={label}>
                    <td className="form-label" style={{ width: '160px', padding: '10px 16px' }}>{label}</td>
                    <td style={{ padding: '10px 16px' }}>
                      <span className="cell-mono">{value}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Line items — uses snapshot fields, never current item.batches */}
          <div className="panel" style={{ animation: 'cardIn 0.4s ease-out 0.1s both' }}>
            <div className="panel__header">
              <span className="panel__title">
                <span className="panel__title-dot" style={{ background: 'var(--info)' }} />
                Line Items
              </span>
              <span className="panel__count">{order.lineItems.length} lines</span>
            </div>
            <div className="panel__body">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>UoM</th>
                    <th>Ordered</th>
                    <th>Received</th>
                    <th>Lot</th>
                    <th>Expires</th>
                    <th>Unit Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {order.lineItems.map((line) => {
                    const itemDeleted = !itemIds.has(line.itemId);
                    return (
                      <tr key={line.id}>
                        <td className="cell-name">
                          {line.name}
                          {itemDeleted && (
                            <> <span className="badge badge--low" style={{ fontSize: '0.6rem' }}>ITEM DELETED</span></>
                          )}
                        </td>
                        <td className="cell-mono">{line.unitOfMeasure}</td>
                        <td className="cell-mono">{line.quantityOrdered}</td>
                        <td className="cell-mono">
                          {line.quantityReceived === null ? '—' : `${line.quantityReceived} of ${line.quantityOrdered}`}
                        </td>
                        <td className="cell-mono">{line.lotNumber ?? '—'}</td>
                        <td className="cell-mono">{line.expirationDate ?? '—'}</td>
                        <td className="cell-mono">${line.unitCost.toFixed(2)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Attachments */}
          {(placedAttachments.length > 0 || receivedAttachments.length > 0) && (
            <div className="panel" style={{ animation: 'cardIn 0.4s ease-out 0.15s both' }}>
              <div className="panel__header">
                <span className="panel__title">
                  <span className="panel__title-dot" style={{ background: 'var(--accent)' }} />
                  Attachments
                </span>
                <span className="panel__count">{order.attachments.length} files</span>
              </div>
              <div className="panel__body">
                {placedAttachments.length > 0 && (
                  <>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', padding: '8px 16px 4px' }}>Order docs</div>
                    <ul className="activity-list">
                      {placedAttachments.map((a) => (
                        <li key={a.id} className="activity-item">
                          <div className="activity-content">
                            <div className="activity-text">{a.originalFilename}</div>
                            <div className="activity-meta">
                              <span>{a.uploadedBy}</span>
                              <span>{(a.sizeBytes / 1024).toFixed(1)} KB</span>
                              <span>{new Date(a.uploadedAt).toLocaleDateString()}</span>
                            </div>
                          </div>
                          <button
                            type="button"
                            className="btn btn-secondary"
                            style={{ padding: '4px 10px', fontSize: '0.7rem' }}
                            onClick={() => openAttachment(a)}
                          >
                            Open
                          </button>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                {receivedAttachments.length > 0 && (
                  <>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', padding: '8px 16px 4px' }}>Receive docs</div>
                    <ul className="activity-list">
                      {receivedAttachments.map((a) => (
                        <li key={a.id} className="activity-item">
                          <div className="activity-content">
                            <div className="activity-text">{a.originalFilename}</div>
                            <div className="activity-meta">
                              <span>{a.uploadedBy}</span>
                              <span>{(a.sizeBytes / 1024).toFixed(1)} KB</span>
                              <span>{new Date(a.uploadedAt).toLocaleDateString()}</span>
                            </div>
                          </div>
                          <button
                            type="button"
                            className="btn btn-secondary"
                            style={{ padding: '4px 10px', fontSize: '0.7rem' }}
                            onClick={() => openAttachment(a)}
                          >
                            Open
                          </button>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            </div>
          )}

          {/* Activity timeline */}
          <div className="panel" style={{ animation: 'cardIn 0.4s ease-out 0.2s both' }}>
            <div className="panel__header">
              <span className="panel__title">
                <span className="panel__title-dot" />
                Activity Log
              </span>
              <span className="panel__count">{orderTxs.length} entries</span>
            </div>
            <div className="panel__body">
              {orderTxs.length === 0 ? (
                <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                  No activity recorded yet
                </div>
              ) : (
                <ul className="activity-list" style={{ maxHeight: '300px' }}>
                  {orderTxs.map((tx) => (
                    <li key={tx.id} className="activity-item">
                      <div className="activity-content">
                        <div className="activity-text">{tx.type}</div>
                        <div className="activity-meta">
                          <span>{tx.performedBy.split('@')[0]}</span>
                          <span>{new Date(tx.timestamp).toLocaleString()}</span>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
