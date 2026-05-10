import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate, Navigate } from 'react-router-dom';
import { useInventory } from '../context/InventoryContext';
import type { OrderReceiveInput } from '../context/inventoryTypes';
import type { Order } from '../models/order';
import { ATTACHMENT_ACCEPT_ATTRIBUTE, mergeFilesDedup } from '../api/attachmentService';
import { todayISO, daysFromTodayISO } from '../utils/dates';

interface DraftReceivedLine {
  id: string;
  name: string;
  unitOfMeasure: string;
  quantityOrdered: number;
  quantityReceived: string;
  lotNumber: string;
  expirationDate: string;
  pastExpirationReason: string;
}

export default function ReceiveOrder() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { orders, loading } = useInventory();
  const order = orders.find((o) => o.id === id);

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
          </div>
          <button className="btn btn-secondary" onClick={() => navigate('/orders')}>Back to Orders</button>
        </div>
      </main>
    );
  }
  // Status-change redirect: covers (a) bookmark/stale-link and (b) the "user's
  // own commit succeeds, status flips, re-render fires the redirect" case.
  if (order.status !== 'placed') {
    return <Navigate to={`/orders/${order.id}`} replace />;
  }
  return <ReceiveForm key={order.id} order={order} />;
}

function ReceiveForm({ order }: { order: Order }) {
  const navigate = useNavigate();
  const { receiveOrder } = useInventory();

  const [actualReceiveDate, setActualReceiveDate] = useState(todayISO());
  const [lines, setLines] = useState<DraftReceivedLine[]>(() =>
    order.lineItems.map((l) => ({
      id: l.id,
      name: l.name,
      unitOfMeasure: l.unitOfMeasure,
      quantityOrdered: l.quantityOrdered,
      quantityReceived: String(l.quantityOrdered),
      lotNumber: '',
      expirationDate: '',
      pastExpirationReason: '',
    })),
  );
  const [attachments, setAttachments] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // If the user's own receive commits while we're rendering (or their session
  // gets a status flip from elsewhere), redirect away.
  useEffect(() => {
    if (order.status !== 'placed') {
      navigate(`/orders/${order.id}`, { replace: true });
    }
  }, [order.status, order.id, navigate]);

  const minDate = daysFromTodayISO(-30);
  const today = todayISO();

  const dateValid = actualReceiveDate >= minDate && actualReceiveDate <= today;

  const overReceiveLines = useMemo(
    () => lines.filter((l) => parseInt(l.quantityReceived, 10) > l.quantityOrdered),
    [lines],
  );

  function updateLine(id: string, patch: Partial<DraftReceivedLine>) {
    setLines((prev) => prev.map((l) => l.id === id ? { ...l, ...patch } : l));
  }

  function valid(): boolean {
    if (!dateValid) return false;
    let anyPositive = false;
    for (const l of lines) {
      const q = parseInt(l.quantityReceived, 10);
      if (Number.isNaN(q) || q < 0) return false;
      if (q > 0) {
        anyPositive = true;
        if (!l.lotNumber.trim() || !l.expirationDate.trim()) return false;
      }
    }
    // All-zero receives are rejected — use Cancel to close without stock.
    return anyPositive;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid() || submitting) return;
    if (overReceiveLines.length > 0) {
      const ok = window.confirm(
        `${overReceiveLines.length} line(s) received MORE than ordered. Continue anyway?`,
      );
      if (!ok) return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const input: OrderReceiveInput = {
        actualReceiveDate,
        receivedLines: lines.map((l) => ({
          id: l.id,
          quantityReceived: parseInt(l.quantityReceived, 10),
          lotNumber: l.lotNumber.trim() || undefined,
          expirationDate: l.expirationDate || undefined,
          pastExpirationReason: l.pastExpirationReason.trim() || undefined,
        })),
        attachments,
      };
      await receiveOrder(order.id, input);
      navigate(`/orders/${order.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  }

  return (
    <main className="page">
      <div className="page-header" style={{ marginBottom: '16px' }}>
        <h1 className="page-title">Receive PO {order.poNumber}</h1>
        <span className="page-subtitle">{order.supplier}</span>
      </div>

      <form onSubmit={handleSubmit}>
        <div className="stock-form-card" style={{ maxWidth: '1100px', animation: 'cardIn 0.4s ease-out both' }}>
          <div className="panel__header">
            <span className="panel__title">
              <span className="panel__title-dot" style={{ background: 'var(--ok)' }} />
              Receive Header
            </span>
          </div>
          <div className="stock-form-body">
            <div className="form-row">
              <div className="form-group" style={{ maxWidth: '260px' }}>
                <label className="form-label">Received On *</label>
                <input
                  className="form-input"
                  type="date"
                  value={actualReceiveDate}
                  onChange={(e) => setActualReceiveDate(e.target.value)}
                  min={minDate}
                  max={today}
                />
                {!dateValid && (
                  <span className="form-hint" style={{ color: 'var(--critical)' }}>
                    Must be between {minDate} and today
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="stock-form-card" style={{ maxWidth: '1100px', marginTop: '24px', animation: 'cardIn 0.4s ease-out 0.1s both' }}>
          <div className="panel__header">
            <span className="panel__title">
              <span className="panel__title-dot" />
              Lines ({lines.length})
            </span>
          </div>
          <div className="stock-form-body">
            {lines.map((line) => {
              const qty = parseInt(line.quantityReceived, 10) || 0;
              const isPastExp = qty > 0 && line.expirationDate && line.expirationDate < today;
              const isShortReceive = qty < line.quantityOrdered;
              const isOverReceive = qty > line.quantityOrdered;
              return (
                <div key={line.id} style={{ borderBottom: '1px solid var(--border)', paddingBottom: '12px', marginBottom: '12px' }}>
                  <div className="form-row" style={{ alignItems: 'flex-end' }}>
                    <div className="form-group" style={{ flex: 2 }}>
                      <label className="form-label">{line.name}</label>
                      <span className="cell-mono" style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                        Ordered: {line.quantityOrdered} {line.unitOfMeasure}
                      </span>
                    </div>
                    <div className="form-group" style={{ maxWidth: '120px' }}>
                      <label className="form-label">Received Qty *</label>
                      <input
                        className="form-input"
                        type="number"
                        min="0"
                        value={line.quantityReceived}
                        onChange={(e) => updateLine(line.id, { quantityReceived: e.target.value })}
                      />
                      {isShortReceive && qty > 0 && (
                        <span className="form-hint" style={{ color: 'var(--low)' }}>Short by {line.quantityOrdered - qty}</span>
                      )}
                      {isOverReceive && (
                        <span className="form-hint" style={{ color: 'var(--critical)' }}>Over by {qty - line.quantityOrdered}</span>
                      )}
                      {qty === 0 && (
                        <span className="form-hint" style={{ color: 'var(--text-muted)' }}>Zero — no stock-in emitted</span>
                      )}
                    </div>
                    <div className="form-group" style={{ maxWidth: '160px' }}>
                      <label className="form-label">Lot Number {qty > 0 && '*'}</label>
                      <input
                        className="form-input"
                        placeholder={qty === 0 ? 'Not required' : 'e.g. TF-24B220'}
                        value={line.lotNumber}
                        disabled={qty === 0}
                        onChange={(e) => updateLine(line.id, { lotNumber: e.target.value })}
                      />
                    </div>
                    <div className="form-group" style={{ maxWidth: '180px' }}>
                      <label className="form-label">Expiration Date {qty > 0 && '*'}</label>
                      <input
                        className="form-input"
                        type="date"
                        value={line.expirationDate}
                        disabled={qty === 0}
                        onChange={(e) => updateLine(line.id, { expirationDate: e.target.value })}
                      />
                    </div>
                  </div>
                  {isPastExp && (
                    <div className="form-row">
                      <div className="form-group" style={{ flex: 1 }}>
                        <span className="form-hint" style={{ color: 'var(--critical)' }}>
                          Lot expires before today — record reason
                        </span>
                        <input
                          className="form-input"
                          placeholder="Why are we accepting an expired lot?"
                          value={line.pastExpirationReason}
                          onChange={(e) => updateLine(line.id, { pastExpirationReason: e.target.value })}
                        />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="stock-form-card" style={{ maxWidth: '1100px', marginTop: '24px', animation: 'cardIn 0.4s ease-out 0.15s both' }}>
          <div className="panel__header">
            <span className="panel__title">
              <span className="panel__title-dot" style={{ background: 'var(--accent)' }} />
              Receive Documents (optional)
            </span>
            <span className="panel__count">{attachments.length} files</span>
          </div>
          <div className="stock-form-body">
            <input
              type="file"
              multiple
              accept={ATTACHMENT_ACCEPT_ATTRIBUTE}
              onChange={(e) => {
                const newFiles = Array.from(e.target.files || []);
                setAttachments((prev) => mergeFilesDedup(prev, newFiles));
                e.target.value = '';
              }}
            />
            {attachments.length > 0 && (
              <ul className="activity-list" style={{ marginTop: '12px' }}>
                {attachments.map((f, idx) => (
                  <li key={idx} className="activity-item">
                    <div className="activity-content">
                      <div className="activity-text">{f.name}</div>
                      <div className="activity-meta">
                        <span>{(f.size / 1024).toFixed(1)} KB</span>
                      </div>
                    </div>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      style={{ padding: '4px 10px', fontSize: '0.7rem' }}
                      onClick={() => setAttachments((prev) => prev.filter((_, i) => i !== idx))}
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {!lines.some((l) => parseInt(l.quantityReceived, 10) > 0) && (
          <div style={{ maxWidth: '1100px', marginTop: '16px', textAlign: 'right' }}>
            <span className="form-hint" style={{ color: 'var(--critical)' }}>
              At least one line must have a received quantity &gt; 0. Use Cancel Order to close without receiving stock.
            </span>
          </div>
        )}
        <div className="btn-group" style={{ justifyContent: 'flex-end', gap: '12px', marginTop: '24px', maxWidth: '1100px' }}>
          <button type="button" className="btn btn-secondary" onClick={() => navigate(`/orders/${order.id}`)} disabled={submitting}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={!valid() || submitting}>
            {submitting ? 'Saving...' : 'Confirm Receive'}
          </button>
        </div>
        {error && (
          <div className="toast toast--error" style={{ position: 'static', maxWidth: '1100px' }}>{error}</div>
        )}
      </form>
    </main>
  );
}
