# Inventory Tracking App — Design Document

**Date:** 2026-04-03
**Status:** Draft (Revised after Codex review rounds 1-2)

## Problem

A team of 5 needs to track physical product inventory (receiving and consuming stock) with full audit trails, low stock alerts, and expiration tracking. The solution should use Microsoft 365 infrastructure the team already has.

## Architecture

### Stack

- **Frontend:** React SPA (TypeScript)
- **Backend:** None — browser talks directly to Microsoft Graph API
- **Storage:** JSON file in a SharePoint document library (not personal OneDrive)
- **Auth:** Microsoft SSO via MSAL
- **Hosting:** Azure Static Web Apps (free tier)
- **Build tool:** Vite
- **Testing:** Vitest + React Testing Library

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
        "sku": "WDG-001",
        "name": "Blue Widget",
        "quantity": 50,
        "location": "Warehouse A, Shelf 3",
        "category": "Widgets",
        "supplier": "Acme Corp",
        "unitCost": 4.99,
        "reorderPoint": 50,
        "expirationDate": "2027-03-15",
        "imageFilename": "wdg-001.jpg",
        "note": "Received from Acme, PO #1234"
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
interface InventoryItem {
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
  imageFilename: string;
  createdBy: string;
  updatedAt: string;
}
```

For a team of 5 with moderate inventory, replaying the full log on each load is fast enough. If the log grows large in the future, a persisted snapshot with freshness verification can be added later.

### Transaction Types

| Type | Data Fields | Effect |
|------|-------------|--------|
| `item-create` | All item fields | Adds new item |
| `item-update` | Changed fields only + itemId | Updates item fields |
| `item-delete` | itemId only | Removes item |
| `stock-in` | quantity, note | Increases item quantity |
| `stock-out` | quantity, note | Decreases item quantity (rejects if would go negative) |

### Key Decisions

- **Append-only log is the single source of truth** — no separate inventory file, no persisted snapshot
- **State derived in memory on every load** — always fresh, no stale cache risk
- **Idempotency via transaction UUID** — before appending, check if the ID already exists in the log. Prevents duplicate submissions on retry
- **All mutations audited** — no way to change quantity without creating a transaction record
- **`performedBy` comes from MSAL token claims** — not user-editable
- **Business rule validation on write** — stock-out rejects if current quantity (derived from fresh transaction log) would go negative

## UI Screens

### 1. Dashboard

- Total item count and total inventory value (qty x unit cost)
- Low stock alerts: items at or below reorder point
- Expiring soon: items expiring within 30 days
- Recent activity feed (last 10 transactions)

### 2. Inventory List

- Searchable, sortable, filterable table of all items
- Filters: category, location, supplier, stock status (normal / low / out)
- Click row to open item detail (full edit of item metadata, image, transaction history for that item)
- **No inline quantity edit** — all quantity changes go through Stock In/Out to maintain audit trail

### 3. Stock In / Stock Out

- Single form with toggle for direction (receiving vs. using)
- Search/select item by SKU or name
- Enter quantity and optional note
- Validates quantity > 0 and (for stock-out) current stock >= requested quantity
- Submit appends to `transactions.json` and re-derives state in memory

### 4. Export

- Export current inventory to .xlsx or .csv
- Export transaction log to .xlsx or .csv
- Date range filter for transaction export

### Navigation

- Top bar with: Dashboard, Inventory, Stock In/Out, Export
- Logged-in user name + sign out button

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

## Alerts

- Low stock and expiration alerts are checked client-side on every data load
- No push notifications: users see alerts when they open the app

## Security

### Permissions

- **`Sites.Selected`** (recommended) — grants access only to the specific SharePoint site used by the app. Requires an admin to explicitly grant the app access to the site via Microsoft Graph or PowerShell. This is the minimum-scope option.
- **`Sites.ReadWrite.All`** (fallback) — grants delegated access to all site collections the signed-in user can access. This is tenant-wide, not site-scoped. Use only if `Sites.Selected` setup is impractical.
- **`User.Read`** for logged-in user info

### Token Handling

- MSAL handles token storage and refresh
- Token cache stored in `sessionStorage` — persists across page reloads within the tab, cleared on tab close. Avoids re-login on every refresh (which `memoryStorage` would cause) while limiting exposure compared to `localStorage`.
- Content Security Policy headers configured on Azure Static Web Apps

### Audit Integrity Note

This is a browser-only app. Users with SharePoint edit access could theoretically modify the JSON files directly. For this team of 5, this is an accepted trade-off. If tamper-proof audit is ever needed, writes should be routed through an Azure Function that validates and signs entries.

## Tech Dependencies

| Package | Purpose |
|---------|---------|
| `react`, `react-dom` | UI framework |
| `@azure/msal-browser`, `@azure/msal-react` | Microsoft SSO |
| `@microsoft/microsoft-graph-client` | SharePoint file operations |
| `@tanstack/react-table` | Sortable/filterable inventory table |
| `react-router-dom` | Page navigation |
| `xlsx` | Export to Excel/CSV |
| `uuid` | Generate transaction and item IDs |
| `zod` | Runtime schema validation for JSON files |
| `vite` | Build tool |
| `vitest` | Unit/integration testing |
| `@testing-library/react` | Component testing |

## Project Structure

```
src/
  auth/           — MSAL config, auth provider wrapper
  api/            — Graph API helpers (read/write JSON, upload images)
  components/     — reusable UI (table, forms, alerts, toasts)
  pages/
    Dashboard.tsx
    InventoryList.tsx
    ItemDetail.tsx
    StockForm.tsx
    Export.tsx
  models/         — TypeScript types + Zod schemas for Transaction, Item
  utils/          — conflict resolution, state derivation, date helpers
  App.tsx         — router + layout
  main.tsx        — entry point
```

## Implementation Phases

### Phase 1: Bootstrap
- `npm create vite@latest` with React + TypeScript template
- Install dependencies
- Set up Vitest configuration
- Create project structure

### Phase 2: Auth & Environment Config
- Azure AD app registration (one-time manual step)
- MSAL configuration with environment variables
- Auth provider wrapper component
- Login/logout flow

### Phase 3: Storage Abstraction
- Graph API client wrapper (authenticated requests)
- JSON file read/write helpers with eTag tracking
- Zod schemas for Transaction validation
- Image upload/download helpers

### Phase 4: Mutation Engine
- Transaction append with idempotency check
- State derivation from transaction log (replay function)
- Conflict retry with business rule revalidation
- Negative-inventory guard on stock-out

### Phase 5: Tests
- Unit tests for state derivation logic
- Unit tests for conflict retry and idempotency
- Unit tests for business rule validation (negative stock, etc.)
- Integration tests for Graph API wrapper (mocked)

### Phase 6: UI
- App shell with router and navigation
- Dashboard page
- Inventory list with TanStack Table
- Item detail view
- Stock In/Out form
- Export page

## Azure Setup

### 1. Azure AD App Registration (one-time)

1. Go to Azure Portal > Entra ID > App registrations > New registration
2. Name: "Inventory Tracking App"
3. Supported account types: "Accounts in this organizational directory only"
4. Redirect URI: `http://localhost:5173` (dev) and your production URL
5. Under API permissions, add Microsoft Graph:
   - **Recommended:** `Sites.Selected` (delegated permission) — then grant site-level access via PowerShell or Graph API
   - **Fallback:** `Sites.ReadWrite.All` (delegated) — tenant-wide access to all sites the user can reach
   - `User.Read` (delegated) — get logged-in user info
6. Grant admin consent for the permissions
7. Copy the Application (client) ID and Tenant ID — these go in the app's MSAL config

### 2. SharePoint Site & Document Library

1. Create a SharePoint site (or use an existing team site)
2. The default "Documents" library works, or create a dedicated library
3. Create the `/InventoryApp/` folder structure
4. All team members get access via SharePoint site membership
5. Store the site ID and drive ID in the app's environment config
6. If using `Sites.Selected`, grant the app access to this specific site

### 3. Azure Static Web Apps Deployment

1. Create a Static Web App resource in Azure Portal (free tier)
2. Connect it to your git repository
3. Set app location to `/` and output location to `dist`
4. Azure auto-deploys on every push
5. No custom domain name required — Azure provides a URL like `https://<auto-generated-name>.azurestaticapps.net`
6. Add the production URL as a redirect URI in the app registration
