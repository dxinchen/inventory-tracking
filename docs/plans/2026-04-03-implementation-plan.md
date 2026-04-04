# Inventory Tracking App — Implementation Plan

**Date:** 2026-04-03
**Design doc:** [2026-04-03-inventory-tracking-design.md](./2026-04-03-inventory-tracking-design.md)

---

## Phase 1: Bootstrap

### 1.1 Scaffold Vite + React + TypeScript project
- [ ] Run `npm create vite@latest . -- --template react-ts` in project root
- [ ] Clean up default Vite boilerplate (remove default CSS, logos, App content)

### 1.2 Install dependencies
- [ ] Production deps:
  ```
  npm install @azure/msal-browser @azure/msal-react \
    @tanstack/react-table react-router-dom xlsx uuid zod
  ```
- [ ] Dev deps:
  ```
  npm install -D vitest @testing-library/react @testing-library/jest-dom \
    @testing-library/user-event jsdom @types/uuid
  ```

### 1.3 Configure tooling
- [ ] Add Vitest config to `vite.config.ts`:
  ```ts
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
  }
  ```
- [ ] Create `src/test/setup.ts` with `@testing-library/jest-dom` import
- [ ] Add test script to `package.json`: `"test": "vitest"`
- [ ] Create `.env.example` with placeholder values:
  ```
  VITE_MSAL_CLIENT_ID=
  VITE_MSAL_TENANT_ID=
  VITE_SHAREPOINT_SITE_ID=
  VITE_SHAREPOINT_DRIVE_ID=
  VITE_SHAREPOINT_FOLDER_PATH=/InventoryApp
  ```
- [ ] Add `.env` to `.gitignore`

### 1.4 Create directory structure
- [ ] Create folders: `src/auth/`, `src/api/`, `src/components/`, `src/pages/`, `src/models/`, `src/utils/`, `src/hooks/`, `src/test/`

**Milestone:** `npm run dev` starts, `npm test` runs with zero tests passing.

---

## Phase 2: Auth & Environment Config

### 2.1 MSAL configuration
- [ ] Create `src/auth/msalConfig.ts`
  - Export `msalConfig` object using `VITE_MSAL_CLIENT_ID` and `VITE_MSAL_TENANT_ID` from env
  - Authority: `https://login.microsoftonline.com/{tenantId}`
  - Redirect URI: `window.location.origin`
  - Cache location: `sessionStorage` — persists tokens across page reloads within the browser tab while clearing on tab close. **Note:** the design doc says `memoryStorage`; we override this because `memoryStorage` forces re-login on every page refresh which is unacceptable UX. `sessionStorage` is the practical compromise — scoped to the tab, cleared on close, and does not persist indefinitely like `localStorage`. Update the design doc to match.
- [ ] Define login scopes: `Sites.Selected` (or `Sites.ReadWrite.All`), `User.Read`

### 2.2 Auth provider wrapper
- [ ] Create `src/auth/AuthProvider.tsx`
  - Wrap app in `MsalProvider` from `@azure/msal-react`
  - Create `PublicClientApplication` instance from config
- [ ] Create `src/auth/useAuth.ts` custom hook
  - Expose: `isAuthenticated`, `user` (name, email from account), `login()`, `logout()`, `getAccessToken()`
  - `getAccessToken()` uses `acquireTokenSilent` with fallback to `acquireTokenPopup`
  - On app load, call `msalInstance.handleRedirectPromise()` to process any pending auth redirect before checking `isAuthenticated`

### 2.3 Login/logout UI
- [ ] Create `src/components/LoginPage.tsx` — sign-in button, app name
- [ ] Wire up in `App.tsx`: if not authenticated, show LoginPage; otherwise show app shell

**Milestone:** User can sign in with Microsoft account and see their name displayed. Token acquired silently on subsequent visits.

---

## Phase 3: Models & Validation

### 3.1 TypeScript types
- [ ] Create `src/models/transaction.ts`
  ```ts
  type TransactionType = 'item-create' | 'item-update' | 'item-delete' | 'stock-in' | 'stock-out';

  // Stored in transactions.json — includes server-stamped audit fields
  interface Transaction {
    id: string;
    type: TransactionType;
    itemId: string;
    data: ItemCreateData | ItemUpdateData | ItemDeleteData | StockData;
    performedBy: string;   // stamped by appendTransaction(), not caller
    timestamp: string;     // stamped by appendTransaction(), not caller
  }

  // What callers pass to appendTransaction() — no audit fields
  interface TransactionInput {
    id: string;            // client-generated UUID for idempotency
    type: TransactionType;
    itemId: string;
    data: ItemCreateData | ItemUpdateData | ItemDeleteData | StockData;
  }

  interface TransactionLog {
    transactions: Transaction[];
  }

  // Typed data payloads per transaction type
  interface ItemCreateData {
    sku: string; name: string; quantity: number; location: string;
    category: string; supplier: string; unitCost: number;
    reorderPoint: number; expirationDate: string;
    imageFilename?: string; note?: string;
  }
  // Strict whitelist: only metadata fields, NOT quantity/createdBy/id
  interface ItemUpdateData {
    name?: string; location?: string; category?: string;
    supplier?: string; unitCost?: number; reorderPoint?: number;
    expirationDate?: string; imageFilename?: string; note?: string;
  }
  interface ItemDeleteData { note?: string; }
  interface StockData { quantity: number; note?: string; }
  ```
- [ ] Create `src/models/inventory.ts`
  ```ts
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
    imageFilename?: string;  // optional — not all items have images
    createdBy: string;
    updatedAt: string;
  }
  ```

### 3.2 Zod schemas
- [ ] Create `src/models/schemas.ts`
  - `StockDataSchema` — validates `{ quantity: number (> 0), note?: string }`
  - `ItemCreateDataSchema` — validates all required item fields (sku, name, quantity, etc.)
  - `ItemUpdateDataSchema` — validates only whitelisted metadata fields (name, location, category, supplier, unitCost, reorderPoint, expirationDate, imageFilename, note). Uses `.strict()` to reject unknown keys like `quantity`, `createdBy`, or `id`
  - `ItemDeleteDataSchema` — validates `{ note?: string }`
  - `TransactionSchema` — validates a single transaction, using a discriminated union on `type` to select the correct data schema (e.g., `stock-in` and `stock-out` require `StockDataSchema`, `item-create` requires `ItemCreateDataSchema`)
  - `TransactionLogSchema` — validates `{ transactions: Transaction[] }`
  - Used when reading `transactions.json` from SharePoint — rejects entries with missing/invalid fields that would corrupt state derivation

**Milestone:** Types and schemas importable, Zod schemas tested with valid/invalid payloads.

---

## Phase 4: Storage Abstraction (Graph API)

### 4.1 Authenticated fetch wrapper & path config
- [ ] Create `src/api/graphClient.ts`
  - Use a thin `fetch` wrapper instead of `@microsoft/microsoft-graph-client` — we need direct control over `If-Match` headers, 412 status codes, and `@microsoft.graph.downloadUrl` which the SDK does not simplify
  - `graphFetch(url: string, options?: RequestInit)` — attaches `Authorization: Bearer {token}` header, handles common error codes
  - Remove `@microsoft/microsoft-graph-client` from dependencies
- [ ] Create `src/api/paths.ts` — centralized path construction from env vars
  - All paths derived from `VITE_SHAREPOINT_DRIVE_ID` and `VITE_SHAREPOINT_FOLDER_PATH`
  - `getBasePath()` → returns `VITE_SHAREPOINT_FOLDER_PATH` (e.g., `/InventoryApp`)
  - `getTransactionsPath()` → `${getBasePath()}/transactions.json`
  - `getImagesFolderPath()` → `${getBasePath()}/images` (folder path, no trailing slash)
  - `getImageFilePath(filename: string)` → `${getBasePath()}/images/${filename}` (file path, requires filename)
  - `getDriveItemUrl(path: string)` → `https://graph.microsoft.com/v1.0/drives/${driveId}/root:${path}:`
  - **No hardcoded `/InventoryApp` anywhere else in the codebase** — all file/image operations use these helpers

### 4.2 File operations
- [ ] Create `src/api/fileOperations.ts`
  - `readTransactionLog(): Promise<{ data: TransactionLog, eTag: string }>`
    - **Step 1:** Fetch drive item metadata: `GET ${getDriveItemUrl(getTransactionsPath())}` (no `/content`) — returns JSON with `eTag` and `@microsoft.graph.downloadUrl`
    - **Step 2:** Fetch the actual file content from `@microsoft.graph.downloadUrl` (a pre-authenticated URL that works in browsers without 302 redirect issues)
    - **Step 3:** Parse JSON, validate with `TransactionLogSchema` (Zod)
    - **Note:** `GET /drives/{driveId}/root:/{path}:/content` returns a 302 redirect which browsers cannot follow with auth headers. Always use the two-step metadata-then-download approach.
  - `writeTransactionLog(data: TransactionLog, eTag: string): Promise<string>`
    - Uses `PUT /drives/{driveId}/root:/{path}:/content`
    - Sets `If-Match: {eTag}` and `Content-Type: application/json` headers
    - Returns new eTag from response on success
    - Throws `ConflictError` on 412 Precondition Failed
  - `checkFileExists(path: string): Promise<boolean>`
    - `GET /drives/{driveId}/root:/{path}:/` — returns true if 200, false if 404

### 4.3 Image operations
- [ ] Create `src/api/imageOperations.ts`
  - `uploadImage(file: File): Promise<string>` — generates unique sanitized filename (`{uuid}-{sanitized-original-name}`), uploads via `PUT ${getDriveItemUrl(getImageFilePath(filename))}/content`, returns the filename
  - `getImageUrl(filename: string): Promise<string>` — fetches drive item metadata and returns `@microsoft.graph.downloadUrl` for display
  - Upload must complete **before** the transaction append that references the filename — upload-then-append order

### 4.4 Bootstrap helper
- [ ] Create `src/api/bootstrap.ts`
  - `initializeDataStore(): Promise<void>` — one-time initialization only
    1. Verify the SharePoint folder exists: `GET ${getDriveItemUrl(getBasePath())}` — if 404, throw a fatal `ConfigurationError` ("SharePoint folder not found — check VITE_SHAREPOINT_FOLDER_PATH")
    2. Ensure `images/` subfolder exists: `GET ${getDriveItemUrl(getImagesFolderPath())}` — if 404, create it via `POST /drives/{driveId}/root:${getBasePath()}:/children` with body `{ "name": "images", "folder": {}, "@microsoft.graph.conflictBehavior": "fail" }`
    3. Check if `transactions.json` exists via `checkFileExists(getTransactionsPath())`
    4. If not, create it with `{ "transactions": [] }` — **on 409/412 conflict (another browser created it first), treat as success and re-read instead of failing**
    5. If exists, read and validate with Zod
  - **Concurrent bootstrap race:** If two browsers bootstrap simultaneously and both try to create `transactions.json`, the second will get a conflict. Handle by catching 409/412 on creation, then reading the file that the other browser created. Same for `images/` folder.
  - **Post-bootstrap 404s are fatal errors, not auto-recovery.** If `readTransactionLog()` gets a 404 after bootstrap, throw a `DataLossError` ("transactions.json not found — possible accidental deletion or misconfiguration"). Do NOT silently recreate the file, as that would reset the entire inventory.

**Milestone:** Can read/write JSON to SharePoint from the browser using fetch. Manual test: create transactions.json, read it back.

---

## Phase 5: Mutation Engine

### 5.1 State derivation
- [ ] Create `src/utils/deriveState.ts`
  - `deriveInventory(transactions: Transaction[]): InventoryItem[]`
  - Replays transactions in order:
    - `item-create` → add item to map
    - `item-update` → merge changed fields into existing item
    - `item-delete` → remove item from map
    - `stock-in` → increase item quantity, update `updatedAt`
    - `stock-out` → decrease item quantity, update `updatedAt`
  - Returns array of current items

### 5.2 Transaction append with conflict retry
- [ ] Create `src/api/transactionService.ts`
  - `appendTransaction(input: TransactionInput): Promise<InventoryItem[]>`
    - **Callers provide `TransactionInput`** (id, type, itemId, data) — no `performedBy` or `timestamp`
    - `appendTransaction` stamps audit fields internally:
      - `performedBy` = email from active MSAL account (`msalInstance.getActiveAccount().username`)
      - `timestamp` = `new Date().toISOString()`
    - Flow:
      1. Read `transactions.json` → get transactions + eTag
      2. Check idempotency: if `input.id` already in log, return current state (no-op)
      3. Derive current state from transactions
      4. Validate business rules against derived state
      5. Validate that target item exists for `stock-in`, `stock-out`, `item-update`, `item-delete` (throw `ItemNotFoundError` if missing or already deleted)
      6. Build full `Transaction` by stamping `performedBy` + `timestamp` onto `input`
      7. Append to transactions array
      8. Write back with eTag
      9. On `412 Precondition Failed`: re-read, re-check idempotency, re-derive, revalidate, retry (max 3)
      10. On validation failure after retry: throw `InsufficientStockError`
      11. Return updated derived state

### 5.3 Business rule validation
- [ ] Create `src/utils/validation.ts`
  - `validateStockOut(item: InventoryItem, quantity: number)` — throws if `quantity <= 0` or `quantity > item.quantity`
  - `validateStockIn(quantity: number)` — throws if `quantity <= 0`
  - `validateItemCreate(data, existingItems)` — throws if duplicate SKU
  - `validateItemUpdate(data: ItemUpdateData)` — validates data only contains whitelisted fields (already enforced by type + Zod `.strict()`, but explicit runtime check)
  - `validateItemExists(itemId, items)` — throws `ItemNotFoundError` if item not found or already deleted

**Milestone:** Can programmatically append transactions with conflict handling. Unit tests pass for all derivation and validation logic.

---

## Phase 6: Tests (Core Logic)

### 6.1 State derivation tests
- [ ] `src/utils/__tests__/deriveState.test.ts`
  - Empty log → empty inventory
  - Single `item-create` → one item with correct fields
  - `item-create` + `stock-in` → quantity increased
  - `item-create` + `stock-out` → quantity decreased
  - `item-create` + `item-update` → fields merged
  - `item-create` + `item-delete` → item gone
  - Multiple items, interleaved transactions → correct final state

### 6.2 Validation tests
- [ ] `src/utils/__tests__/validation.test.ts`
  - Stock-out with sufficient stock → passes
  - Stock-out exceeding stock → throws
  - Stock-out to exactly zero → passes
  - Stock-out with zero quantity → throws
  - Stock-out with negative quantity → throws
  - Stock-in with zero/negative quantity → throws
  - Duplicate SKU on item-create → throws
  - Item-update with whitelisted fields → passes
  - Item-update attempting to change `quantity` → rejected by Zod strict schema
  - Item-update attempting to change `createdBy` → rejected
  - Stock-out against nonexistent item → throws ItemNotFoundError
  - Item-update against deleted item → throws ItemNotFoundError

### 6.3 Idempotency & audit tests
- [ ] `src/api/__tests__/transactionService.test.ts` (with mocked fetch)
  - Append with new ID → appended, `performedBy` and `timestamp` stamped from MSAL/clock
  - Callers cannot override `performedBy` — input type does not include it
  - Append with existing ID → no-op, returns current state
  - 412 conflict → retries with fresh data
  - 412 conflict + business rule now fails → throws InsufficientStockError
  - 3 retries exhausted → throws

### 6.5 Bootstrap & file operation tests
- [ ] `src/api/__tests__/bootstrap.test.ts` (with mocked fetch)
  - SharePoint folder exists + transactions.json exists → reads and validates
  - SharePoint folder exists + transactions.json missing → creates empty log
  - SharePoint folder missing → throws ConfigurationError
  - Post-bootstrap 404 on read → throws DataLossError (does NOT recreate)
  - Concurrent bootstrap: second browser gets 409/412 on create → catches, re-reads, succeeds
  - Images folder missing → creates via POST to parent's children collection
  - Images folder already exists → no-op
  - Concurrent images folder creation (409 conflict) → catches, continues
- [ ] `src/api/__tests__/fileOperations.test.ts` (with mocked fetch)
  - Read uses two-step metadata + downloadUrl approach
  - Write with valid eTag → success, returns new eTag
  - Write with stale eTag → throws ConflictError

### 6.4 Schema validation tests
- [ ] `src/models/__tests__/schemas.test.ts`
  - Valid transaction log → passes
  - Missing required field → fails
  - Wrong type in field → fails
  - Empty transactions array → passes
  - `stock-out` without `quantity` in data → fails
  - `stock-in` with `quantity: 0` in data → fails
  - `item-create` without `sku` in data → fails
  - `stock-out` with negative `quantity` in data → fails

**Milestone:** `npm test` passes with full coverage on core logic. No UI tests yet.

---

## Phase 7: UI — App Shell & Navigation

### 7.1 App shell
- [ ] Create `src/App.tsx`
  - `BrowserRouter` with routes: `/`, `/inventory`, `/inventory/:id`, `/stock`, `/export`
  - Top nav bar component with links + user name + sign out
  - Wrap in `AuthProvider`
  - On authenticated mount, call `initializeDataStore()` and track its completion in state (`bootstrapReady`)
  - Show a loading/spinner screen until bootstrap completes — **do not render child routes until `bootstrapReady === true`**
  - This prevents `useInventoryData` from racing against file creation on first-run

### 7.2 Layout components
- [ ] Create `src/components/Layout.tsx` — top bar + main content area
- [ ] Create `src/components/NavBar.tsx` — Dashboard, Inventory, Stock In/Out, Export links
- [ ] Create `src/components/Toast.tsx` — simple toast notification for errors/success
- [ ] Create `src/components/ErrorBanner.tsx` — persistent banner for connectivity issues

### 7.3 Data loading hook
- [ ] Create `src/hooks/useInventoryData.ts`
  - Reads `transactions.json` on mount (only called after bootstrap is complete)
  - Derives state via `deriveInventory()`
  - Returns `{ items, transactions, loading, error, refresh }`
  - `refresh()` re-reads and re-derives (called after mutations)
  - If read returns 404 (file deleted externally), surface `DataLossError` — do NOT silently recreate (that would reset inventory)

**Milestone:** App renders with navigation, shows loading state, derives and holds inventory state. First-run bootstrap completes before any data reads.

---

## Phase 8: UI — Dashboard

- [ ] Create `src/pages/Dashboard.tsx`
  - **Summary cards:** total items, total value (sum of qty * unitCost)
  - **Low stock alerts:** table of items where `quantity <= reorderPoint`
  - **Expiring soon:** table of items expiring within 30 days of today
  - **Recent activity:** last 10 transactions with type, item name, quantity, user, timestamp

**Milestone:** Dashboard renders with live data from SharePoint.

---

## Phase 9: UI — Inventory List & Item Detail

### 9.1 Inventory list
- [ ] Create `src/pages/InventoryList.tsx`
  - TanStack Table with columns: SKU, Name, Quantity, Location, Category, Supplier, Unit Cost, Status
  - **Status** column: "OK" / "Low" (at/below reorder) / "Out" (zero) / "Expiring" (within 30d)
  - Search bar: filters across SKU, name, supplier
  - Filter dropdowns: category, location, supplier, status
  - Sortable columns
  - Click row → navigate to `/inventory/:id`

### 9.2 Item detail
- [ ] Create `src/pages/ItemDetail.tsx`
  - Display all item fields
  - Edit form for metadata fields only (name, location, category, supplier, unitCost, reorderPoint, expirationDate) — quantity is NOT editable here
  - Save → creates `item-update` transaction (only whitelisted fields via `ItemUpdateData`)
  - Image display (fetched via `getImageUrl`) + upload button
    - Upload flow: upload image first via `uploadImage()` → get filename → include `imageFilename` in `item-update` transaction data → append transaction. Upload-before-append ensures no broken references.
  - Transaction history for this item (filtered from full log)
  - Delete button → creates `item-delete` transaction (with confirmation dialog)

### 9.3 New item
- [ ] Add "New Item" button on InventoryList
  - Opens form with all fields
  - Save → creates `item-create` transaction with generated UUID for itemId

**Milestone:** Full CRUD for inventory items, all changes audited via transactions.

---

## Phase 10: UI — Stock In / Stock Out

- [ ] Create `src/pages/StockForm.tsx`
  - Toggle: "Receiving" (stock-in) / "Using" (stock-out)
  - Item selector: searchable dropdown by SKU or name
  - Shows current quantity of selected item
  - Quantity input (number, > 0)
  - Note input (optional text)
  - For stock-out: validates quantity <= current stock, shows warning if would trigger low stock alert
  - Submit:
    1. Create transaction with generated UUID
    2. Call `appendTransaction()`
    3. Show success toast with new quantity
    4. On `InsufficientStockError`: show error toast
  - After submit, clear form and refresh data

**Milestone:** Team members can record stock in/out with full validation and audit trail.

---

## Phase 11: UI — Export

- [ ] Create `src/pages/Export.tsx`
  - **Export Inventory** button → generates .xlsx with all current items (all columns)
  - **Export Transactions** button → generates .xlsx with full transaction log
  - Date range picker for transaction export (filters by timestamp)
  - Format toggle: .xlsx or .csv
  - Uses `xlsx` library to generate and trigger browser download

**Milestone:** Team can export data for reporting or backup.

---

## Phase 12: Polish & Error Handling

- [ ] Add loading spinners on all data-fetching pages
- [ ] Add empty states ("No items yet — create your first item")
- [ ] Add error boundary at app root
- [ ] Add CSP headers in `staticwebapp.config.json`
- [ ] Add `staticwebapp.config.json` for SPA fallback routing:
  ```json
  {
    "navigationFallback": {
      "rewrite": "/index.html"
    }
  }
  ```
- [ ] Test all flows end-to-end with real SharePoint site
- [ ] Verify concurrent edits from two browsers resolve correctly

**Milestone:** App is production-ready for team of 5.

---

## Phase 13: Deployment

- [ ] Complete Azure AD app registration (manual — see design doc section "Azure Setup")
- [ ] Set up SharePoint site and document library with the folder matching `VITE_SHAREPOINT_FOLDER_PATH` (default: `/InventoryApp`)
- [ ] Grant app access if using `Sites.Selected`
- [ ] Create Azure Static Web App, connect to git repo
- [ ] Set environment variables in Azure Static Web Apps configuration
- [ ] Add production URL as redirect URI in app registration
- [ ] Deploy via git push
- [ ] Verify login, read, write, and image upload work in production
- [ ] Share URL with team

**Milestone:** App live and accessible by all 5 team members.

---

## Summary

| Phase | What | Key Files |
|-------|------|-----------|
| 1 | Bootstrap | `vite.config.ts`, `package.json`, `.env.example` |
| 2 | Auth | `src/auth/msalConfig.ts`, `AuthProvider.tsx`, `useAuth.ts` |
| 3 | Models | `src/models/transaction.ts`, `inventory.ts`, `schemas.ts` |
| 4 | Storage | `src/api/graphClient.ts`, `fileOperations.ts`, `imageOperations.ts`, `bootstrap.ts` |
| 5 | Mutation engine | `src/utils/deriveState.ts`, `src/api/transactionService.ts`, `validation.ts` |
| 6 | Tests | `__tests__/deriveState.test.ts`, `validation.test.ts`, `transactionService.test.ts`, `bootstrap.test.ts`, `fileOperations.test.ts` |
| 7 | App shell | `App.tsx`, `Layout.tsx`, `NavBar.tsx`, `useInventoryData.ts` |
| 8 | Dashboard | `src/pages/Dashboard.tsx` |
| 9 | Inventory CRUD | `src/pages/InventoryList.tsx`, `ItemDetail.tsx` |
| 10 | Stock form | `src/pages/StockForm.tsx` |
| 11 | Export | `src/pages/Export.tsx` |
| 12 | Polish | Error handling, CSP, empty states, e2e testing |
| 13 | Deploy | Azure setup, production verification |
