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
  expirationDate: string;
  imageFilename?: string;
  createdBy: string;
  updatedAt: string;
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
    id: 'a1', sku: 'WDG-001', name: 'Blue Widget',
    quantity: 234, location: 'Bay A-12', category: 'Widgets',
    supplier: 'Acme Corp', unitCost: 4.99, reorderPoint: 50,
    expirationDate: '2027-03-15',
    createdBy: 'j.martinez@company.com', updatedAt: '2026-04-02T14:30:00Z',
  },
  {
    id: 'a2', sku: 'BLT-003', name: 'Hex Bolt M8',
    quantity: 18, location: 'Bay C-03', category: 'Fasteners',
    supplier: 'BoltWorks Inc', unitCost: 0.45, reorderPoint: 100,
    expirationDate: '',
    createdBy: 'k.chen@company.com', updatedAt: '2026-04-03T09:15:00Z',
  },
  {
    id: 'a3', sku: 'BRG-007', name: '608ZZ Ball Bearing',
    quantity: 0, location: 'Bay B-07', category: 'Bearings',
    supplier: 'Precision Parts Co', unitCost: 2.10, reorderPoint: 30,
    expirationDate: '',
    createdBy: 'j.martinez@company.com', updatedAt: '2026-04-01T11:00:00Z',
  },
  {
    id: 'a4', sku: 'CW-012', name: '14 AWG Copper Wire',
    quantity: 520, location: 'Bay D-01', category: 'Electrical',
    supplier: 'WireTech Solutions', unitCost: 1.85, reorderPoint: 100,
    expirationDate: '',
    createdBy: 'r.patel@company.com', updatedAt: '2026-03-29T16:45:00Z',
  },
  {
    id: 'a5', sku: 'GSK-045', name: 'Silicone Gasket Ring',
    quantity: 87, location: 'Bay A-04', category: 'Seals',
    supplier: 'FlexSeal Mfg', unitCost: 3.20, reorderPoint: 40,
    expirationDate: '2026-04-18',
    createdBy: 'k.chen@company.com', updatedAt: '2026-04-03T07:30:00Z',
  },
  {
    id: 'a6', sku: 'AL-021', name: 'Aluminum Sheet 4x8',
    quantity: 42, location: 'Bay E-02', category: 'Raw Materials',
    supplier: 'MetalSource Ltd', unitCost: 28.50, reorderPoint: 10,
    expirationDate: '',
    createdBy: 'r.patel@company.com', updatedAt: '2026-03-31T13:20:00Z',
  },
  {
    id: 'a7', sku: 'NS-033', name: 'Nylon Ratchet Strap',
    quantity: 12, location: 'Bay F-11', category: 'Packaging',
    supplier: 'PackRight Inc', unitCost: 7.99, reorderPoint: 25,
    expirationDate: '',
    createdBy: 'j.martinez@company.com', updatedAt: '2026-04-02T10:10:00Z',
  },
  {
    id: 'a8', sku: 'GP-008', name: 'Borosilicate Glass Panel',
    quantity: 15, location: 'Bay B-02', category: 'Glass',
    supplier: 'ClearView Glass', unitCost: 45.00, reorderPoint: 5,
    expirationDate: '2026-04-28',
    createdBy: 'k.chen@company.com', updatedAt: '2026-04-01T09:00:00Z',
  },
  {
    id: 'a9', sku: 'LUB-114', name: 'Synthetic Grease 500ml',
    quantity: 6, location: 'Bay C-08', category: 'Lubricants',
    supplier: 'ChemLube Corp', unitCost: 12.75, reorderPoint: 15,
    expirationDate: '2026-04-10',
    createdBy: 'r.patel@company.com', updatedAt: '2026-04-03T08:00:00Z',
  },
  {
    id: 'a10', sku: 'FLT-022', name: 'HEPA Filter Cartridge',
    quantity: 150, location: 'Bay A-09', category: 'Filtration',
    supplier: 'AirPure Systems', unitCost: 18.50, reorderPoint: 20,
    expirationDate: '2027-01-30',
    createdBy: 'j.martinez@company.com', updatedAt: '2026-03-28T15:00:00Z',
  },
];

export const mockTransactions: Transaction[] = [
  {
    id: 't01', type: 'stock-in', itemId: 'a1',
    data: { quantity: 100, note: 'PO #4821 — Acme Q2 shipment' },
    performedBy: 'j.martinez@company.com', timestamp: '2026-04-03T14:22:00Z',
  },
  {
    id: 't02', type: 'stock-out', itemId: 'a9',
    data: { quantity: 4, note: 'Line 3 maintenance' },
    performedBy: 'r.patel@company.com', timestamp: '2026-04-03T13:45:00Z',
  },
  {
    id: 't03', type: 'stock-out', itemId: 'a2',
    data: { quantity: 32, note: 'Assembly floor request' },
    performedBy: 'k.chen@company.com', timestamp: '2026-04-03T11:30:00Z',
  },
  {
    id: 't04', type: 'item-create', itemId: 'a10',
    data: { sku: 'FLT-022', name: 'HEPA Filter Cartridge', quantity: 150 },
    performedBy: 'j.martinez@company.com', timestamp: '2026-04-03T10:00:00Z',
  },
  {
    id: 't05', type: 'stock-in', itemId: 'a5',
    data: { quantity: 50, note: 'Emergency restock from FlexSeal' },
    performedBy: 'k.chen@company.com', timestamp: '2026-04-03T09:15:00Z',
  },
  {
    id: 't06', type: 'stock-out', itemId: 'a3',
    data: { quantity: 15, note: 'Motor rebuild — Line 1' },
    performedBy: 'r.patel@company.com', timestamp: '2026-04-02T16:30:00Z',
  },
  {
    id: 't07', type: 'item-update', itemId: 'a6',
    data: { unitCost: 28.50, note: 'Price update per new contract' },
    performedBy: 'j.martinez@company.com', timestamp: '2026-04-02T14:00:00Z',
  },
  {
    id: 't08', type: 'stock-in', itemId: 'a4',
    data: { quantity: 200, note: 'WireTech bulk order received' },
    performedBy: 'r.patel@company.com', timestamp: '2026-04-02T11:20:00Z',
  },
  {
    id: 't09', type: 'stock-out', itemId: 'a7',
    data: { quantity: 8, note: 'Outbound shipping — Customer #2291' },
    performedBy: 'k.chen@company.com', timestamp: '2026-04-02T09:45:00Z',
  },
  {
    id: 't10', type: 'stock-in', itemId: 'a8',
    data: { quantity: 10, note: 'ClearView quarterly delivery' },
    performedBy: 'j.martinez@company.com', timestamp: '2026-04-01T15:10:00Z',
  },
  {
    id: 't11', type: 'stock-out', itemId: 'a1',
    data: { quantity: 20, note: 'Production batch #887' },
    performedBy: 'r.patel@company.com', timestamp: '2026-04-01T13:00:00Z',
  },
  {
    id: 't12', type: 'stock-out', itemId: 'a9',
    data: { quantity: 6, note: 'Preventive maintenance schedule' },
    performedBy: 'k.chen@company.com', timestamp: '2026-04-01T10:30:00Z',
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
    if (!item.expirationDate) return false;
    const exp = new Date(item.expirationDate);
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
