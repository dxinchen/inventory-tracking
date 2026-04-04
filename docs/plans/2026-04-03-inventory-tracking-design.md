# Inventory Tracking App — Design Document

**Date:** 2026-04-03
**Status:** Implemented

## Problem

A team of 5 needs to track physical biolab inventory (receiving and consuming stock) with full audit trails, low stock alerts, lot/batch-level expiration tracking, and FEFO consumption. The solution should use Microsoft 365 infrastructure the team already has.

## Architecture

### Stack

- **Frontend:** React 19 SPA (TypeScript)
- **Backend:** None — browser talks directly to Microsoft Graph API
- **Storage:** JSON file in a SharePoint document library (not personal OneDrive)
- **Auth:** Microsoft SSO via MSAL (optional in dev — app runs with mock data when not configured)
- **Hosting:** GitHub Pages (primary) or Azure Static Web Apps
- **Build tool:** Vite
- **Testing:** Vitest (54 tests)
- **Validation:** Zod (runtime schema validation)

### Why SharePoint Instead of OneDrive

OneDrive shared folders are exposed as `remoteItem`s via Microsoft Graph, requiring resolution through `driveId` and `itemId` — you cannot simply access `/InventoryApp/` from another user's drive by path. A SharePoint document library provides:
- A stable, team-owned location accessible by all members via a consistent `driveId`
- Proper path-based access: `/drives/{siteLibraryDriveId}/root:/InventoryApp/transactions.json`
- Per-site permission scoping via `Sites.Selected`
- Built-in version history as a safety net

### How It Works

1. User opens the app and signs in with their Microsoft 365 account
2. MSAL acquires a token with SharePoint permissions
3. The app reads/writes JSON files in a SharePoint document library via Microsoft Graph API
4. All 5 team members have access to the same SharePoint site, so everyone sees the same data

**Dev mode:** When `VITE_MSAL_CLIENT_ID` is not set, the app skips authentication entirely and loads mock biolab data. This allows frontend development without Azure AD setup.

### Data Files in SharePoint

```
/InventoryApp/
  transactions.json   — append-only log (single source of truth)
  images/             — product images (referenced by filename)
```

## Data Model

### Single Source of Truth: Append-Only Transaction Log

`transactions.json` is the only data file. Current inventory state is derived in memory by replaying the transaction log on every load. There is no persisted snapshot — this eliminates stale cache risks under concurrent writes and keeps the architecture simple for v1.

### Transaction (`transactions.json`)

```json
{
  "transactions": [
    {
      "id": "uuid (client-generated, used for idempotency)",
      "type": "stock-in | stock-out | item-create | item-update | item-delete",
      "itemId": "uuid",
      "data": {
        "sku": "PCR-001",
        "name": "PCR Tubes 0.2mL (1000pk)",
        "quantity": 50,
        "location": "Room 101, Bench 2",
        "category": "Consumables",
        "supplier": "Thermo Fisher",
        "vendor": "Fisher Scientific",
        "referenceNumber": "PO-2026-0001",
        "unitCost": 45.00,
        "reorderPoint": 10,
        "lotNumber": "TF-PCR2401A",
        "expirationDate": "2027-03-15",
        "imageFilename": "pcr-001.jpg",
        "note": "Received from Thermo Fisher, PO #1234"
      },
      "performedBy": "user@company.com",
      "timestamp": "2026-04-03T10:30:00Z"
    }
  ]
}
```

### Derived State (In-Memory Only)

On every load, the app replays all transactions to produce the current item list:

```typescript
interface Batch {
  lotNumber: string;
  expirationDate: string;
  quantity: number;
  receivedAt: string;
}

interface InventoryItem {
  id: string;
  sku: string;
  name: string;
  quantity: number;        // total across all batches
  location: string;
  category: string;
  supplier: string;
  vendor: string;
  referenceNumber: string;
  unitCost?: number;       // optional — not all items have cost info
  reorderPoint: number;
  imageFilename?: string;
  createdBy: string;
  updatedAt: string;
  batches: Batch[];        // lot-level inventory with per-batch expiration
  earliestExpiration: string; // computed from batches for quick display
}
```

### Lot / Batch Tracking

Each stock-in records a **lot number** and **expiration date**, creating a new batch. Items can have multiple batches with different lot numbers and expiration dates. When stock is consumed (stock-out), the app uses **FEFO** (First Expired, First Out) — the earliest-expiring batch is consumed first. Batches without expiration dates sort last.

### Transaction Types

| Type | Data Fields | Effect |
|------|-------------|--------|
| `item-create` | All item fields + optional lotNumber/expirationDate | Adds new item, optionally creates initial batch |
| `item-update` | Changed metadata fields only (strict whitelist) | Updates item fields (not quantity) |
| `item-delete` | itemId only + optional note | Removes item |
| `stock-in` | quantity, lotNumber, expirationDate, note | Creates new batch, increases total quantity |
| `stock-out` | quantity, note | Consumes from earliest-expiring batch (FEFO) |

### Key Decisions

- **Append-only log is the single source of truth** — no separate inventory file, no persisted snapshot
- **State derived in memory on every load** — always fresh, no stale cache risk
- **Batch-level expiration** — expiration is per stock-in, not per item. Different orders of the same SKU can have different lot numbers and expiration dates
- **FEFO consumption** — stock-out automatically takes from the earliest-expiring batch first
- **Idempotency via transaction UUID** — before appending, check if the ID already exists in the log
- **All mutations audited** — no way to change quantity without creating a transaction record
- **`performedBy` comes from MSAL token claims** — not user-editable
- **Business rule validation on write** — stock-out rejects if current quantity would go negative

## Permissions

### Role-Based Access via Azure AD App Roles

- **All authenticated users** can: add/edit/delete items, record stock in/out, export data
- **Admins only** can: bulk import via CSV

Admin access is controlled through **Azure AD App Roles**:
1. Create an "Admin" app role in Azure AD app registration
2. Assign specific users or security groups to the role
3. The app reads the `roles` claim from the user's ID token

In local dev, admins are defined in `src/auth/permissions.ts` as a fallback list.

## UI Screens

### 1. Dashboard

- **Summary cards:** Total Products (with unit count), Low Stock Alerts, Expiring Soon — no inventory value card (unit cost data is incomplete)
- **Low stock alerts:** clickable table of items at or below reorder point, links to item detail
- **Expiring soon:** clickable table showing individual **batches** (not rolled-up SKUs) expiring within 30 days, with lot number, batch quantity, days remaining, and urgency bar
- **Recent activity:** scrollable feed of last 10 transactions with type icons, item names, quantities, user, and relative timestamps

### 2. Inventory List

- Searchable, sortable, filterable table of all items
- Columns: SKU, Name, Qty, Location, Category, Supplier, Vendor, Ref#, Unit Cost, Status
- Search bar filters across SKU, name, supplier
- Filter dropdowns: category, stock status (normal / low / out)
- Click row to open item detail
- "+ New Item" button to create items inline
- Empty state when no items exist

### 3. Item Detail

- **Left panel:** Item metadata displayed as a details table with inline editing (click any value to edit). All fields editable except SKU and quantity. Unit cost uses text input with decimal mode (no spinner arrows).
- **Right panel top:** Lot/Batch Inventory table showing all active batches with lot number, quantity, expiration date, and received date
- **Right panel bottom:** Activity Log showing all transactions for this specific item
- Edit and Delete buttons available to all authenticated users
- Each edit creates an `item-update` transaction for audit trail

### 4. Stock In / Stock Out

- Toggle for direction: Receiving (stock-in) / Using (stock-out)
- Searchable item dropdown showing current quantity
- Quantity input with validation
- **Stock-in only:** Lot Number and Expiration Date fields (creates a new batch)
- **Stock-out:** FEFO consumption (no lot selection needed — auto-consumes earliest expiring)
- Validates: quantity > 0, sufficient stock for stock-out

### 5. Import (Admin Only)

- Non-admin users see a lock screen explaining admin access is required
- CSV file upload with drag-and-drop
- **Append mode (default):** New SKUs are created, existing SKUs shown as "Skip"
- **Overwrite mode (optional):** Checkbox to enable updating existing items, with red warning banner
- Preview table showing each row's status: New, Skip, or Update
- Sample CSV file available at `public/sample-import.csv`

### 6. Export

- Export current inventory as CSV
- Export transaction log as CSV
- Download blank CSV template for import
- Format toggle (CSV/XLSX, with XLSX noted as requiring additional library)

### Navigation

- Top bar with: Dashboard, Inventory, Stock In/Out, Import, Export
- Logged-in user email + avatar initials + sign out button

## Concurrency Handling

### Single-File Append with ETag

Since `transactions.json` is the only writable file:

1. Read `transactions.json` and store the eTag from the Graph API response
2. Derive current state in memory from the transaction log
3. Validate business rules against derived state (e.g., sufficient stock for stock-out)
4. Append the new transaction to the array
5. Write back with `If-Match: {eTag}` header
6. If Graph returns `412 Precondition Failed`: re-fetch the full transaction log, check idempotency (is our transaction ID already there?), if not re-derive state, revalidate business rules, re-append and retry (up to 3 attempts)

### Retry Semantics

- On conflict retry, **re-derive state from fresh transaction log and revalidate business rules** (e.g., re-check stock-out doesn't cause negative inventory)
- If revalidation fails after retry, surface error to user: "Insufficient stock — another team member may have used this item"
- Each retry uses the freshest data — no stale cache involved

## Error Handling

- SharePoint unreachable: clear error banner, no silent failures
- No offline mode: if SharePoint is down, the app shows an error state
- All API errors surfaced as user-friendly toast notifications
- **Schema validation on JSON read** — if the file is corrupted or has unexpected shape, show a clear error rather than crashing
- **Error boundary** at app root catches unhandled React errors

## Alerts

- Low stock and expiration alerts are checked client-side on every data load
- No push notifications: users see alerts when they open the app

## Security

### Permissions

- **`Sites.Selected`** (recommended) — grants access only to the specific SharePoint site used by the app
- **`Sites.ReadWrite.All`** (fallback) — grants delegated access to all site collections the signed-in user can access
- **`User.Read`** for logged-in user info

### Token Handling

- MSAL handles token storage and refresh
- Token cache stored in `sessionStorage` — persists across page reloads within the tab, cleared on tab close
- Content Security Policy headers configured on Azure Static Web Apps

### Audit Integrity Note

This is a browser-only app. Users with SharePoint edit access could theoretically modify the JSON files directly. For this team of 5, this is an accepted trade-off. If tamper-proof audit is ever needed, writes should be routed through an Azure Function that validates and signs entries.

## Tech Dependencies

| Package | Purpose |
|---------|---------|
| `react`, `react-dom` | UI framework (React 19) |
| `@azure/msal-browser`, `@azure/msal-react` | Microsoft SSO |
| `react-router-dom` | Page navigation |
| `uuid` | Generate transaction and item IDs |
| `zod` | Runtime schema validation for JSON files |
| `vite` | Build tool |
| `vitest` | Unit testing (54 tests) |
| `@testing-library/react`, `@testing-library/jest-dom` | Component/DOM testing utilities |

**Not used (removed from original plan):**
- `@microsoft/microsoft-graph-client` — thin `fetch` wrapper used instead for direct control over ETag headers
- `@tanstack/react-table` — plain HTML tables used for simplicity
- `xlsx` — CSV export implemented natively, XLSX deferred

## Project Structure

```
src/
  auth/           — MSAL config, AuthGate (dev/prod mode switching), AuthProvider, permissions
  api/            — Graph API helpers (graphClient, fileOperations, transactionService, bootstrap)
  components/     — reusable UI (LoginPage, ErrorBoundary)
  context/        — InventoryContext (shared mutable state with transaction audit trail)
  mock/           — biolab sample data and helper functions
  models/         — TypeScript types + Zod schemas (inventory, transaction, schemas)
  pages/
    Dashboard.tsx
    InventoryList.tsx
    NewItem.tsx
    ItemDetail.tsx
    StockForm.tsx
    Import.tsx
    Export.tsx
  utils/          — deriveState (FEFO batch engine), validation, date helpers
  test/           — test setup
  App.tsx         — router + layout + auth
  main.tsx        — entry point
public/
  sample-import.csv — sample CSV for import testing
docs/
  plans/          — design doc + implementation plan
  deployment-guide.md — step-by-step Azure deployment
.github/
  workflows/
    deploy.yml    — GitHub Pages deployment via GitHub Actions
```

## Deployment

### Option A: GitHub Pages (Current)

- GitHub Actions workflow builds on push to `master` and deploys to GitHub Pages
- Vite `base` set to `/inventory-tracking/` and BrowserRouter uses matching `basename`
- Live at `https://dxinchen.github.io/inventory-tracking/`
- In dev mode (no MSAL configured), runs with mock data — no auth required

### Option B: Azure Static Web Apps

1. Create a Static Web App resource in Azure Portal (free tier)
2. Connect to git repository, set app location `/` and output `dist`
3. Set environment variables for MSAL and SharePoint
4. Add production URL as redirect URI in Azure AD app registration
5. SPA fallback routing configured via `staticwebapp.config.json`

## Azure Setup (for Production with SharePoint)

### 1. Azure AD App Registration

1. Go to Azure Portal > Entra ID > App registrations > New registration
2. Name: "Inventory Tracking App", Single tenant
3. Redirect URI: SPA, `http://localhost:5173` + production URL
4. API permissions: `Sites.ReadWrite.All` (delegated), `User.Read` (delegated)
5. Grant admin consent
6. App roles: Create "Admin" role (Value: `Admin`, Users/Groups)
7. Assign admin users via Enterprise applications > Users and groups

### 2. SharePoint Site & Document Library

1. Create a SharePoint team site
2. Create `/InventoryApp/` folder in the document library
3. Get Site ID and Drive ID via Graph Explorer
4. All team members get access via SharePoint site membership
