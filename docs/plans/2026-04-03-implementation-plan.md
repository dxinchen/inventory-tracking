# Inventory Tracking App — Implementation Plan

**Date:** 2026-04-03
**Status:** Complete
**Design doc:** [2026-04-03-inventory-tracking-design.md](./2026-04-03-inventory-tracking-design.md)

---

## Phase 1: Bootstrap

### 1.1 Scaffold Vite + React + TypeScript project
- [x] Run `npm create vite@latest . -- --template react-ts` in project root
- [x] Clean up default Vite boilerplate (remove default CSS, logos, App content)

### 1.2 Install dependencies
- [x] Production deps: `react-router-dom`, `uuid`, `zod`, `@azure/msal-browser`, `@azure/msal-react`
- [x] Dev deps: `vitest`, `@testing-library/react`, `@testing-library/jest-dom`, `@testing-library/user-event`, `jsdom`, `@types/uuid`

### 1.3 Configure tooling
- [x] Add Vitest config to `vite.config.ts` (using `vitest/config` for type support)
- [x] Create `src/test/setup.ts` with `@testing-library/jest-dom` import
- [x] Add test script to `package.json`: `"test": "vitest"`
- [x] Create `.env.example` with placeholder values
- [x] Add `.env` to `.gitignore`

### 1.4 Create directory structure
- [x] Create folders: `src/auth/`, `src/api/`, `src/components/`, `src/context/`, `src/pages/`, `src/models/`, `src/utils/`, `src/mock/`, `src/test/`

**Milestone:** `npm run dev` starts, `npm test` runs. DONE.

---

## Phase 2: Auth & Environment Config

### 2.1 MSAL configuration
- [x] Create `src/auth/msalConfig.ts`
  - Exports `msalConfig` using `VITE_MSAL_CLIENT_ID` and `VITE_MSAL_TENANT_ID` from env
  - Uses `import type { Configuration }` (type-only import required to avoid runtime crash — `Configuration` is a type-only export from MSAL)
  - Cache location: `sessionStorage`
  - Login scopes: `User.Read`, `Sites.ReadWrite.All`

### 2.2 Auth gate (dev/prod mode switching)
- [x] Create `src/auth/AuthGate.tsx`
  - Detects if MSAL is configured via `VITE_MSAL_CLIENT_ID`
  - **Dev mode** (no client ID): Skips auth entirely, passes mock email `d.chen@biolabs.com`
  - **Production mode**: Dynamically imports MSAL to avoid crashing when not configured, shows `LoginPage` until authenticated, handles SSO flow
  - Passes `userEmail` and `onLogout` to children via render prop

### 2.3 Auth provider (for Graph API usage)
- [x] Create `src/auth/AuthProvider.tsx`
  - Wraps app in `MsalProvider` from `@azure/msal-react`
  - Exports `msalInstance` for use by Graph API client and permissions check

### 2.4 Permissions (Azure AD App Roles)
- [x] Create `src/auth/permissions.ts`
  - `isAdmin(email?)` checks Azure AD token claims for "Admin" role first
  - Falls back to `DEV_ADMINS` list for local dev: `['xdu@mabwell-therapeutics.com']`
  - Admin role only controls CSV import; all users can CRUD items and record stock

### 2.5 Login UI
- [x] Create `src/components/LoginPage.tsx` — sign-in button with app branding

**Milestone:** Auth works in both dev (mock) and production (MSAL) modes. DONE.

---

## Phase 3: Models & Validation

### 3.1 TypeScript types
- [x] Create `src/models/transaction.ts`
  - `Transaction`, `TransactionInput`, `TransactionLog` types
  - `ItemCreateData` — all item fields + optional `lotNumber`, `expirationDate` for initial batch
  - `ItemUpdateData` — strict whitelist of metadata fields (no quantity/createdBy)
  - `StockData` — `quantity`, optional `lotNumber`, `expirationDate`, `note`
  - `unitCost` is optional throughout (not all items have cost data)
- [x] Create `src/models/inventory.ts`
  - `Batch` interface: `lotNumber`, `expirationDate`, `quantity`, `receivedAt`
  - `InventoryItem` interface: includes `vendor`, `referenceNumber`, `batches[]`, `earliestExpiration`, optional `unitCost`

### 3.2 Zod schemas
- [x] Create `src/models/schemas.ts`
  - Discriminated union on `type` field to select correct data schema
  - `StockDataSchema`, `ItemCreateDataSchema`, `ItemUpdateDataSchema` (strict), `ItemDeleteDataSchema`
  - `TransactionSchema`, `TransactionLogSchema`

**Milestone:** Types and schemas importable, Zod schemas tested. DONE.

---

## Phase 4: Storage Abstraction (Graph API)

### 4.1 Authenticated fetch wrapper
- [x] Create `src/api/graphClient.ts`
  - Thin `fetch` wrapper (not `@microsoft/microsoft-graph-client` — need direct ETag/412 control)
  - `graphFetch(url, options)` attaches Bearer token
  - Custom error classes: `GraphError`, `ConflictError` (412), `ConfigurationError`, `DataLossError`
  - Note: Uses explicit property declarations (not parameter properties) for `erasableSyntaxOnly` compatibility

### 4.2 File operations
- [x] Create `src/api/fileOperations.ts`
  - `readTransactionLog()` — two-step metadata + downloadUrl approach
  - `writeTransactionLog(data, eTag)` — PUT with If-Match header

### 4.3 Bootstrap helper
- [x] Create `src/api/bootstrap.ts`
  - Verifies SharePoint folder exists, creates images subfolder, initializes transactions.json
  - Handles concurrent bootstrap race conditions

**Milestone:** Can read/write JSON to SharePoint. DONE.

---

## Phase 5: Mutation Engine

### 5.1 State derivation with FEFO batch tracking
- [x] Create `src/utils/deriveState.ts`
  - `deriveInventory(transactions)` — replays transaction log to produce current items
  - `sortBatchesFEFO(batches)` — sorts by expiration date, batches without expiration sort last
  - `consumeFEFO(batches, quantity)` — takes from earliest-expiring batch first, removes depleted batches
  - `stock-in` creates a new batch with lot number and expiration
  - `stock-out` consumes via FEFO across all batches
  - Maintains `earliestExpiration` computed from active batches

### 5.2 Transaction append with conflict retry
- [x] Create `src/api/transactionService.ts`
  - `appendTransaction(input)` — stamps `performedBy` and `timestamp`, handles ETag conflict retry (max 3)
  - Idempotency check before append

### 5.3 Business rule validation
- [x] Create `src/utils/validation.ts`
  - `validateStockOut`, `validateStockIn`, `validateItemCreate` (duplicate SKU check), `validateItemUpdate`, `validateItemExists`
  - Custom error classes: `InsufficientStockError`, `ItemNotFoundError`, `DuplicateSkuError`

### 5.4 Shared mutable state (React Context)
- [x] Create `src/context/InventoryContext.tsx`
  - Wraps mock data in React state with mutation methods
  - `addItem`, `updateItem`, `deleteItem`, `stockIn` (with lot/expiration), `stockOut` (FEFO)
  - Each mutation creates a `Transaction` record (audit trail)
  - Stamps `performedBy` from authenticated user email
  - Exposes `isAdmin` flag from permissions check

**Milestone:** Full mutation engine with FEFO batch consumption. DONE.

---

## Phase 6: Tests (Core Logic)

### 6.1 State derivation tests (with FEFO)
- [x] `src/utils/__tests__/deriveState.test.ts` — 19 tests
  - Empty log, item CRUD, stock in/out, multiple items
  - FEFO: consumes earliest-expiring batch first
  - FEFO: batches without expiration consumed last
  - FEFO: removes fully depleted batches
  - FEFO: partial consumption across multiple batches
  - Earliest expiration tracking

### 6.2 Validation tests
- [x] `src/utils/__tests__/validation.test.ts` — 14 tests
  - Stock-out: sufficient stock, exceeding stock, exactly zero, zero/negative quantity
  - Stock-in: zero/negative quantity
  - Duplicate SKU, item-update whitelist, nonexistent item

### 6.3 Schema validation tests
- [x] `src/models/__tests__/schemas.test.ts` — 8 tests
  - Valid/invalid transaction logs, missing fields, wrong types, discriminated union validation

### 6.4 File operations tests
- [x] `src/api/__tests__/fileOperations.test.ts` — 4 tests
  - Two-step read, write with ETag, conflict error

### 6.5 Transaction service tests
- [x] `src/api/__tests__/transactionService.test.ts` — 5 tests
  - Append, idempotency, conflict retry, audit stamping

### 6.6 Bootstrap tests
- [x] `src/api/__tests__/bootstrap.test.ts` — 4 tests
  - Folder exists, file creation, configuration error, concurrent race

**Milestone:** 54 tests passing. DONE.

---

## Phase 7: UI — App Shell & Navigation

- [x] Create `src/App.tsx`
  - `BrowserRouter` with `basename="/inventory-tracking"` for GitHub Pages
  - Routes: `/`, `/inventory`, `/inventory/new`, `/inventory/:id`, `/stock`, `/import`, `/export`
  - Wrapped in `ErrorBoundary` > `AuthGate` > `InventoryProvider`
  - NavBar with links + user email + avatar initials + sign out
- [x] Create `src/components/ErrorBoundary.tsx` — catches unhandled React errors
- [x] "Cargo Manifest" industrial-utilitarian design theme
  - Dark charcoal background, amber accents
  - JetBrains Mono (monospace) + Outfit (display) fonts
  - Staggered card-in animations

**Milestone:** App shell renders with navigation and auth. DONE.

---

## Phase 8: UI — Dashboard

- [x] Create `src/pages/Dashboard.tsx`
  - **Summary cards:** Total Products (with unit count), Low Stock Alerts, Expiring Soon
  - No Inventory Value card (unit cost data is incomplete across items)
  - **Low stock table:** Items at/below reorder point, clickable → item detail
  - **Expiring soon table:** Per-BATCH rows (not per-SKU) with lot number, batch quantity, location, days remaining, urgency bar — clickable → item detail
  - **Activity feed:** Last 10 transactions with type icons, quantities, user first name, relative timestamps
  - Dashboard panels use `align-items: start` to avoid mismatched heights
  - Activity list has `max-height: 420px` with scroll

**Milestone:** Dashboard renders with live context-driven data. DONE.

---

## Phase 9: UI — Inventory List & Item Detail

### 9.1 Inventory list
- [x] Create `src/pages/InventoryList.tsx`
  - Plain HTML table (not TanStack Table — simpler for this scale)
  - Columns: SKU, Name, Qty, Location, Category, Supplier, Vendor, Ref#, Unit Cost, Status
  - Search bar filters across SKU, name, supplier
  - Filter dropdowns: category, stock status
  - Sortable columns
  - Click row → `/inventory/:id`
  - "+ New Item" button → `/inventory/new`
  - Empty state when no items

### 9.2 Item detail
- [x] Create `src/pages/ItemDetail.tsx`
  - Left panel: details table with **inline text editing** (click any value to edit)
  - Unit cost uses `type="text"` with `inputMode="decimal"` (no spinner arrows)
  - Right panel top: Lot/Batch Inventory table (lot number, qty, expiration, received date)
  - Right panel bottom: Activity Log filtered to this item's transactions
  - Edit/Delete buttons for all authenticated users
  - Each edit creates `item-update` transaction

### 9.3 New item
- [x] Create `src/pages/NewItem.tsx`
  - Full form for all item fields
  - Creates `item-create` transaction with generated UUID

**Milestone:** Full CRUD for inventory items, all changes audited. DONE.

---

## Phase 10: UI — Stock In / Stock Out

- [x] Create `src/pages/StockForm.tsx`
  - Toggle: Receiving (stock-in) / Using (stock-out)
  - Searchable item dropdown showing current quantity
  - Quantity input with validation
  - **Stock-in:** Lot Number + Expiration Date fields (creates new batch)
  - **Stock-out:** FEFO consumption (auto-consumes earliest expiring, no lot selection needed)
  - Validates: quantity > 0, sufficient stock for stock-out
  - Success/error feedback after submission

**Milestone:** Stock in/out with batch tracking and FEFO. DONE.

---

## Phase 11: UI — Import (Admin Only)

- [x] Create `src/pages/Import.tsx`
  - Non-admin users see lock screen explaining admin access required
  - CSV file upload with drag-and-drop zone
  - **Append mode (default):** New SKUs created, existing SKUs shown as "Skip"
  - **Overwrite mode:** Optional checkbox with red warning banner
  - Preview table showing status badges: New, Skip, or Update
  - Imports create `item-create` transactions for audit trail
- [x] Create `public/sample-import.csv` — 10 biolab items with realistic data

**Milestone:** Admin-only bulk CSV import with preview. DONE.

---

## Phase 12: UI — Export

- [x] Create `src/pages/Export.tsx`
  - Export current inventory as CSV (all columns including vendor, referenceNumber, earliestExpiration)
  - Export transaction log as CSV (with item SKU/name lookup)
  - Download blank CSV template for import
  - Format toggle (CSV/XLSX, with XLSX noted as needing additional library)
  - Optional `unitCost` handled gracefully (empty string if not set)

**Milestone:** Data export for reporting and backup. DONE.

---

## Phase 13: Polish & Error Handling

- [x] Add error boundary at app root (`src/components/ErrorBoundary.tsx`)
- [x] Add empty states on inventory list ("No items yet")
- [x] Add CSP headers in `staticwebapp.config.json`
- [x] Add SPA fallback routing in `staticwebapp.config.json`
- [x] Mock data uses realistic biolab supplies (PCR tubes, filter tips, Taq polymerase, DMEM, anti-CD3 mAb, etc.)

**Milestone:** App is production-ready. DONE.

---

## Phase 14: Deployment

### GitHub Pages (primary)
- [x] Create `.github/workflows/deploy.yml` — builds on push to `master`, deploys via `actions/deploy-pages@v4`
- [x] Set `base: '/inventory-tracking/'` in `vite.config.ts`
- [x] Set `basename="/inventory-tracking"` on `BrowserRouter`
- [x] Configure GitHub Pages source to "GitHub Actions" (not legacy branch deploy)
- [x] Live at `https://dxinchen.github.io/inventory-tracking/`

### Azure Static Web Apps (optional, for production with SharePoint)
- [x] Create `staticwebapp.config.json` with SPA fallback and CSP headers
- [x] Create `docs/deployment-guide.md` with step-by-step Azure deployment instructions
- [x] Create comprehensive `README.md` with deployment steps, CSV import guide, permissions info

**Milestone:** App deployed and accessible. DONE.

---

## Summary

| Phase | What | Status | Key Files |
|-------|------|--------|-----------|
| 1 | Bootstrap | Done | `vite.config.ts`, `package.json`, `.env.example` |
| 2 | Auth | Done | `src/auth/msalConfig.ts`, `AuthGate.tsx`, `AuthProvider.tsx`, `permissions.ts` |
| 3 | Models | Done | `src/models/transaction.ts`, `inventory.ts`, `schemas.ts` |
| 4 | Storage | Done | `src/api/graphClient.ts`, `fileOperations.ts`, `bootstrap.ts` |
| 5 | Mutation engine | Done | `src/utils/deriveState.ts`, `validation.ts`, `src/context/InventoryContext.tsx` |
| 6 | Tests (54) | Done | `__tests__/deriveState.test.ts`, `validation.test.ts`, `schemas.test.ts`, + 3 more |
| 7 | App shell | Done | `App.tsx`, `ErrorBoundary.tsx`, `LoginPage.tsx` |
| 8 | Dashboard | Done | `src/pages/Dashboard.tsx` |
| 9 | Inventory CRUD | Done | `src/pages/InventoryList.tsx`, `ItemDetail.tsx`, `NewItem.tsx` |
| 10 | Stock form | Done | `src/pages/StockForm.tsx` |
| 11 | Import | Done | `src/pages/Import.tsx`, `public/sample-import.csv` |
| 12 | Export | Done | `src/pages/Export.tsx` |
| 13 | Polish | Done | `ErrorBoundary`, CSP, empty states, mock data |
| 14 | Deploy | Done | `.github/workflows/deploy.yml`, `staticwebapp.config.json`, `README.md` |
