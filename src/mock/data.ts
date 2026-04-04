export interface Batch {
  lotNumber: string;
  expirationDate: string;
  quantity: number;
  receivedAt: string;
}

export interface InventoryItem {
  id: string;
  sku: string;
  name: string;
  quantity: number;
  location: string;
  category: string;
  supplier: string;
  unitCost: number;
  reorderPoint: number;
  vendor: string;
  referenceNumber: string;
  imageFilename?: string;
  createdBy: string;
  updatedAt: string;
  batches: Batch[];
  earliestExpiration: string;
}

export interface Transaction {
  id: string;
  type: 'stock-in' | 'stock-out' | 'item-create' | 'item-update' | 'item-delete';
  itemId: string;
  data: Record<string, unknown>;
  performedBy: string;
  timestamp: string;
}

export const mockItems: InventoryItem[] = [
  {
    id: 'a1', sku: 'PCR-001', name: 'PCR Tubes 0.2mL (1000pk)',
    quantity: 2400, location: 'Room 102, Shelf A3', category: 'Consumables',
    supplier: 'Thermo Fisher', unitCost: 42.00, reorderPoint: 500,
    vendor: 'Thermo Fisher Scientific', referenceNumber: 'PO-2026-0041',
    createdBy: 'j.martinez@biolabs.com', updatedAt: '2026-04-02T14:30:00Z',
    earliestExpiration: '2026-12-01',
    batches: [
      { lotNumber: 'TF-24A109', expirationDate: '2026-12-01', quantity: 400, receivedAt: '2026-01-15T10:00:00Z' },
      { lotNumber: 'TF-24B220', expirationDate: '2027-06-15', quantity: 2000, receivedAt: '2026-04-02T14:30:00Z' },
    ],
  },
  {
    id: 'a2', sku: 'PIP-010', name: 'Filter Tips 10uL (960pk)',
    quantity: 8, location: 'Room 102, Shelf B1', category: 'Consumables',
    supplier: 'Eppendorf', unitCost: 85.50, reorderPoint: 50,
    vendor: 'Eppendorf North America', referenceNumber: 'PO-2026-0038',
    createdBy: 'k.chen@biolabs.com', updatedAt: '2026-04-03T09:15:00Z',
    earliestExpiration: '',
    batches: [{ lotNumber: 'EP-26M03', expirationDate: '', quantity: 8, receivedAt: '2026-03-10T09:00:00Z' }],
  },
  {
    id: 'a3', sku: 'ENZ-TAQ', name: 'Taq DNA Polymerase 500U',
    quantity: 0, location: 'Freezer -20C, Rack 3', category: 'Enzymes',
    supplier: 'New England Biolabs', unitCost: 148.00, reorderPoint: 5,
    vendor: 'NEB', referenceNumber: 'PO-2026-0029',
    createdBy: 'j.martinez@biolabs.com', updatedAt: '2026-04-01T11:00:00Z',
    earliestExpiration: '',
    batches: [],
  },
  {
    id: 'a4', sku: 'MED-DMEM', name: 'DMEM High Glucose 500mL',
    quantity: 36, location: 'Cold Room 4C, Shelf 2', category: 'Cell Culture',
    supplier: 'Gibco', unitCost: 18.90, reorderPoint: 10,
    vendor: 'Thermo Fisher Scientific', referenceNumber: 'PO-2026-0035',
    createdBy: 'r.patel@biolabs.com', updatedAt: '2026-03-29T16:45:00Z',
    earliestExpiration: '2026-09-30',
    batches: [
      { lotNumber: 'GB-2401A', expirationDate: '2026-09-30', quantity: 12, receivedAt: '2026-01-20T10:00:00Z' },
      { lotNumber: 'GB-2415B', expirationDate: '2027-01-15', quantity: 24, receivedAt: '2026-03-29T16:45:00Z' },
    ],
  },
  {
    id: 'a5', sku: 'AB-CD3', name: 'Anti-CD3 mAb (Clone OKT3)',
    quantity: 4, location: 'Freezer -20C, Rack 1', category: 'Antibodies',
    supplier: 'BioLegend', unitCost: 320.00, reorderPoint: 3,
    vendor: 'BioLegend Inc', referenceNumber: 'PO-2026-0042',
    createdBy: 'k.chen@biolabs.com', updatedAt: '2026-04-03T07:30:00Z',
    earliestExpiration: '2026-04-18',
    batches: [
      { lotNumber: 'BL-B401552', expirationDate: '2026-04-18', quantity: 1, receivedAt: '2025-11-05T10:00:00Z' },
      { lotNumber: 'BL-B408821', expirationDate: '2026-10-30', quantity: 3, receivedAt: '2026-04-03T07:30:00Z' },
    ],
  },
  {
    id: 'a6', sku: 'CHM-ETOH', name: 'Ethanol 200 Proof 4L',
    quantity: 12, location: 'Chem Storage, Cabinet 2', category: 'Chemicals',
    supplier: 'Sigma-Aldrich', unitCost: 65.00, reorderPoint: 4,
    vendor: 'MilliporeSigma', referenceNumber: 'PO-2026-0033',
    createdBy: 'r.patel@biolabs.com', updatedAt: '2026-03-31T13:20:00Z',
    earliestExpiration: '',
    batches: [{ lotNumber: 'SA-SHBQ4532', expirationDate: '', quantity: 12, receivedAt: '2026-03-31T13:20:00Z' }],
  },
  {
    id: 'a7', sku: 'GLV-NBR', name: 'Nitrile Gloves Medium (200pk)',
    quantity: 6, location: 'Room 101, Supply Cabinet', category: 'PPE',
    supplier: 'VWR International', unitCost: 14.99, reorderPoint: 20,
    vendor: 'Avantor / VWR', referenceNumber: 'PO-2026-0040',
    createdBy: 'j.martinez@biolabs.com', updatedAt: '2026-04-02T10:10:00Z',
    earliestExpiration: '',
    batches: [{ lotNumber: 'VWR-G26M02', expirationDate: '', quantity: 6, receivedAt: '2026-02-15T10:00:00Z' }],
  },
  {
    id: 'a8', sku: 'KIT-ELISA', name: 'Human IL-6 ELISA Kit',
    quantity: 3, location: 'Room 103, Shelf C2', category: 'Assay Kits',
    supplier: 'R&D Systems', unitCost: 495.00, reorderPoint: 2,
    vendor: 'Bio-Techne / R&D Systems', referenceNumber: 'PO-2026-0031',
    createdBy: 'k.chen@biolabs.com', updatedAt: '2026-04-01T09:00:00Z',
    earliestExpiration: '2026-04-28',
    batches: [{ lotNumber: 'RD-P260114', expirationDate: '2026-04-28', quantity: 3, receivedAt: '2026-01-14T10:00:00Z' }],
  },
  {
    id: 'a9', sku: 'FBS-500', name: 'Fetal Bovine Serum 500mL',
    quantity: 2, location: 'Freezer -20C, Rack 5', category: 'Cell Culture',
    supplier: 'Gibco', unitCost: 385.00, reorderPoint: 3,
    vendor: 'Thermo Fisher Scientific', referenceNumber: 'PO-2026-0039',
    createdBy: 'r.patel@biolabs.com', updatedAt: '2026-04-03T08:00:00Z',
    earliestExpiration: '2026-04-10',
    batches: [
      { lotNumber: 'GB-FBS2401', expirationDate: '2026-04-10', quantity: 1, receivedAt: '2025-10-15T10:00:00Z' },
      { lotNumber: 'GB-FBS2418', expirationDate: '2026-12-20', quantity: 1, receivedAt: '2026-03-20T10:00:00Z' },
    ],
  },
  {
    id: 'a10', sku: 'LAD-1KB', name: '1kb DNA Ladder 500uL',
    quantity: 18, location: 'Freezer -20C, Rack 2', category: 'Reagents',
    supplier: 'New England Biolabs', unitCost: 62.00, reorderPoint: 4,
    vendor: 'NEB', referenceNumber: 'PO-2026-0044',
    createdBy: 'j.martinez@biolabs.com', updatedAt: '2026-03-28T15:00:00Z',
    earliestExpiration: '2027-01-30',
    batches: [{ lotNumber: 'NEB-10117S', expirationDate: '2027-01-30', quantity: 18, receivedAt: '2026-03-28T15:00:00Z' }],
  },
];

export const mockTransactions: Transaction[] = [
  {
    id: 't01', type: 'stock-in', itemId: 'a1',
    data: { quantity: 2000, note: 'Thermo Fisher Q2 shipment — PO #4821' },
    performedBy: 'j.martinez@biolabs.com', timestamp: '2026-04-03T14:22:00Z',
  },
  {
    id: 't02', type: 'stock-out', itemId: 'a9',
    data: { quantity: 1, note: 'Cell culture expansion — Dr. Patel lab' },
    performedBy: 'r.patel@biolabs.com', timestamp: '2026-04-03T13:45:00Z',
  },
  {
    id: 't03', type: 'stock-out', itemId: 'a2',
    data: { quantity: 12, note: 'RNA extraction workflow — Room 103' },
    performedBy: 'k.chen@biolabs.com', timestamp: '2026-04-03T11:30:00Z',
  },
  {
    id: 't04', type: 'item-create', itemId: 'a10',
    data: { sku: 'LAD-1KB', name: '1kb DNA Ladder 500uL', quantity: 18 },
    performedBy: 'j.martinez@biolabs.com', timestamp: '2026-04-03T10:00:00Z',
  },
  {
    id: 't05', type: 'stock-in', itemId: 'a5',
    data: { quantity: 3, note: 'Emergency restock from BioLegend' },
    performedBy: 'k.chen@biolabs.com', timestamp: '2026-04-03T09:15:00Z',
  },
  {
    id: 't06', type: 'stock-out', itemId: 'a3',
    data: { quantity: 2, note: 'PCR amplification — BRCA panel' },
    performedBy: 'r.patel@biolabs.com', timestamp: '2026-04-02T16:30:00Z',
  },
  {
    id: 't07', type: 'item-update', itemId: 'a6',
    data: { unitCost: 65.00, note: 'Price update per new MilliporeSigma contract' },
    performedBy: 'j.martinez@biolabs.com', timestamp: '2026-04-02T14:00:00Z',
  },
  {
    id: 't08', type: 'stock-in', itemId: 'a4',
    data: { quantity: 24, note: 'Gibco quarterly media order received' },
    performedBy: 'r.patel@biolabs.com', timestamp: '2026-04-02T11:20:00Z',
  },
  {
    id: 't09', type: 'stock-out', itemId: 'a7',
    data: { quantity: 10, note: 'Restocked BSL-2 suite dispensers' },
    performedBy: 'k.chen@biolabs.com', timestamp: '2026-04-02T09:45:00Z',
  },
  {
    id: 't10', type: 'stock-in', itemId: 'a8',
    data: { quantity: 2, note: 'R&D Systems backorder fulfilled' },
    performedBy: 'j.martinez@biolabs.com', timestamp: '2026-04-01T15:10:00Z',
  },
  {
    id: 't11', type: 'stock-out', itemId: 'a1',
    data: { quantity: 480, note: 'High-throughput screening run #112' },
    performedBy: 'r.patel@biolabs.com', timestamp: '2026-04-01T13:00:00Z',
  },
  {
    id: 't12', type: 'stock-out', itemId: 'a9',
    data: { quantity: 1, note: 'Thawing new passage — iPSC maintenance' },
    performedBy: 'k.chen@biolabs.com', timestamp: '2026-04-01T10:30:00Z',
  },
];

// Helpers
export function getItemById(id: string): InventoryItem | undefined {
  return mockItems.find(item => item.id === id);
}

export function getItemName(itemId: string): string {
  return getItemById(itemId)?.name ?? 'Unknown Item';
}

export function getItemSku(itemId: string): string {
  return getItemById(itemId)?.sku ?? '???';
}

export function getLowStockItems(): InventoryItem[] {
  return mockItems.filter(item => item.quantity <= item.reorderPoint);
}

export function getExpiringItems(withinDays = 30): InventoryItem[] {
  const now = new Date();
  const cutoff = new Date(now.getTime() + withinDays * 24 * 60 * 60 * 1000);
  return mockItems.filter(item => {
    if (!item.earliestExpiration) return false;
    const exp = new Date(item.earliestExpiration);
    return exp <= cutoff && exp >= now;
  });
}

export function getTotalValue(): number {
  return mockItems.reduce((sum, item) => sum + item.quantity * item.unitCost, 0);
}

export function formatCurrency(value: number): string {
  if (value >= 1000) {
    return `$${(value / 1000).toFixed(1)}K`;
  }
  return `$${value.toFixed(2)}`;
}

export function formatCurrencyFull(value: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
}

export function timeAgo(timestamp: string): string {
  const now = new Date('2026-04-03T15:00:00Z'); // frozen "now" for mock
  const then = new Date(timestamp);
  const diffMs = now.getTime() - then.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return 'yesterday';
  return `${diffDays}d ago`;
}

export function daysUntil(dateStr: string): number {
  const now = new Date('2026-04-03T15:00:00Z');
  const target = new Date(dateStr);
  return Math.ceil((target.getTime() - now.getTime()) / 86400000);
}

export function getFirstName(email: string): string {
  const local = email.split('@')[0];
  const first = local.split('.')[0];
  return first.charAt(0).toUpperCase() + first.slice(1);
}
