# Orders Feature Design

**Date:** 2026-05-09
**Status:** Design (revised after independent Codex review + adversarial Opus 4.7 review), ready for implementation plan

## Overview

Add a Purchase Order (PO) feature to the inventory tracker. Most orders repeat the same items, so the form is optimized for fast re-ordering: search existing inventory, autofill from the most recent line item, edit what's different, save. Items that don't yet exist can be quick-added with minimum fields.

Orders follow a two-step lifecycle: **placed → received**. Receiving a PO emits one `stock-in` transaction per (non-zero) line in the SAME atomic write as the `order-receive` event, so the existing batch / FEFO machinery keeps working unchanged.

## Pre-requisite: unify MSAL

The codebase currently has TWO MSAL instances:

1. `src/auth/AuthProvider.tsx` exports a singleton `msalInstance` and provides `MsalProvider`. `src/api/transactionService.ts:14` and any future Graph caller import `msalInstance` from here.
2. `src/auth/AuthGate.tsx:47` creates its OWN `PublicClientApplication` inside `MsalAuthGate` for the login flow.

`src/App.tsx:86` wraps with `AuthGate` but **NOT** with `AuthProvider`, so the exported `msalInstance` is never initialized. Today this is invisible because pages use the mock-backed `InventoryContext` and never call `transactionService`. As soon as orders go through `appendTransactions`, `getCurrentUserEmail()` (which reads `msalInstance.getActiveAccount()`) will throw `'Not authenticated'`.

**Fix (must land before order mutations are wired to Graph):** `MsalAuthGate` is refactored to use the singleton `msalInstance` from `AuthProvider.tsx` instead of creating a local one. Either:

- Move the init logic from `MsalAuthGate.useEffect` into `AuthProvider`, wrap the app with `AuthProvider` inside `App.tsx`, and shrink `AuthGate` to a render-prop consumer of `useMsal()` from `@azure/msal-react`; or
- Delete `AuthProvider.tsx` and have `transactionService.ts` import the same singleton that `AuthGate.tsx` currently constructs locally (move the construction to a shared module).

Either approach yields one initialized instance. Listed as Step 0 in the implementation order.

## Architecture: event-sourced, not file-based

The existing app is event-sourced: `transactions.json` is the SOLE source of truth, and `deriveInventory(transactions)` rebuilds inventory state by replaying the log (`src/utils/deriveState.ts:52`). There is NO `inventory.json`. Orders follow the same model:

- **Orders are derived state.** A new `deriveOrders(transactions)` function replays `order-*` transactions and returns the current `Order[]`. No separate `orders.json` file. Cross-file atomicity is therefore not a concern.
- **Three new transaction types** added to the existing discriminated union: `order-create`, `order-receive`, `order-cancel`.
- **Multi-event writes** (e.g. receive emits 1 `order-receive` + N `stock-in`) require a new `appendTransactions(inputs[])` helper that commits all of them in a single ETag cycle. Without this, partial network failure could leave inconsistent state.

## Data model

### Transaction model changes (`src/models/transaction.ts`, `src/models/schemas.ts`)

Add three transaction types to the existing union:

```ts
export type TransactionType =
  | 'item-create' | 'item-update' | 'item-delete'
  | 'stock-in'   | 'stock-out'
  | 'order-create' | 'order-receive' | 'order-cancel';
```

For `order-*` events, the existing `itemId: uuid` field is reinterpreted as the **order's UUID**. The Zod base schema already enforces UUID format, so no schema relaxation is needed; we document the reinterpretation in `transaction.ts`. `stock-in` transactions emitted from a receive event carry a new optional `orderId?: string` on `StockData` for traceability back to the originating PO.

**ID-space disjointness.** Order UUIDs and item UUIDs are both `crypto.randomUUID()` outputs from the same v4 generator, so collision probability is `2⁻¹²² × N²` — astronomically negligible. But because the two ID spaces share the same field name (`itemId`), a collision is silently catastrophic: an `item-delete` against an order's UUID would not raise an error, and `deriveOrders` would not see anything wrong. Guards:

1. **Defensive ignore in `deriveOrders`.** If the input is an `item-*` or `stock-*` transaction whose `itemId` matches a known order, log a console warning and ignore for order derivation purposes (and vice versa). Treat unknown order references in `order-*` events the same way (warn + ignore, do not throw — keeps the log replayable).
2. **Invariant unit test.** `deriveState.test.ts` adds an explicit test asserting the union of derived order IDs and derived item IDs is disjoint, with a fixture that intentionally produces a collision and verifies the defensive-ignore branch fires.

Three new data payload schemas (Zod):

- `OrderCreateDataSchema` — header fields + `lineItems[]` + `attachments[]` (placement docs). Per-line refinements: `quantityOrdered > 0`, `unitCost >= 0`, `name` and `unitOfMeasure` non-empty, `id` is a UUID and unique within the array.
- `OrderReceiveDataSchema` — `receivedLines[]` (line id, quantityReceived, lotNumber?, expirationDate?) + `attachments[]` (receive docs) + `actualReceiveDate`. Per-line Zod refinements: `quantityReceived` is a non-negative integer; `lotNumber` non-empty AND `expirationDate` parseable IFF `quantityReceived > 0`. **Cross-schema check** (cannot live purely in Zod since it needs the target order's `lineItems`): in `validateTransaction()` for `order-receive`, assert `receivedLines.length === order.lineItems.length` AND `receivedLines.map(r => r.id).sort() ≡ order.lineItems.map(l => l.id).sort()`. An empty `receivedLines` array is rejected with a `ReceiveCoverageError` — submitting "receive nothing" is forbidden; users must use Cancel for that.
- `OrderCancelDataSchema` — `note?`. Optional `replacedBy?: string` carries the new order's UUID when cancellation is part of a Cancel & Re-create batch (informational only — no derivation depends on it).

These join the existing `TransactionSchema` discriminated union in `src/models/schemas.ts`.

### `Order` (derived, not persisted)

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | matches the `itemId` of the originating `order-create` tx |
| `poNumber` | string | manual entry, unique across non-cancelled orders (cancelled orders release their PO#) |
| `orderConfirmationNumber` | string | required |
| `supplier` | string | one supplier per PO |
| `orderDate` | ISO date | from `order-create` transaction timestamp |
| `expectedDeliveryDate` | ISO date \| null | optional |
| `actualReceiveDate` | ISO date \| null | set on `order-receive` |
| `status` | `'placed' \| 'received' \| 'cancelled'` | derived from the latest order-* event |
| `lineItems` | `OrderLineItem[]` | at least 1 required at create time |
| `attachments` | `OrderAttachment[]` | tagged by `stage` |
| `createdBy` | email | from `order-create.performedBy` |
| `updatedAt` | ISO timestamp | latest order-* event timestamp |
| `note` | string \| null | optional |

### `OrderLineItem`

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | stable across the order's lifecycle |
| `itemId` | string | links to `InventoryItem.id` |
| `name` | string | snapshot at order time |
| `unitOfMeasure` | string | `'each' \| 'box' \| 'kit' \| 'case'` or custom |
| `quantityOrdered` | number | `> 0` |
| `quantityReceived` | number \| null | set on receive; `0` allowed (no stock-in emitted) |
| `unitCost` | number | `>= 0` |
| `lotNumber` | string \| null | required iff `quantityReceived > 0` |
| `expirationDate` | ISO date \| null | required iff `quantityReceived > 0` |

### `OrderAttachment`

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | |
| `stage` | `'placed' \| 'received'` | which bucket |
| `filename` | string | sanitized, uuid-prefixed name as stored on SharePoint |
| `originalFilename` | string | as uploaded |
| `contentType` | string | MIME |
| `sizeBytes` | number | |
| `uploadedAt` | ISO timestamp | |
| `uploadedBy` | email | |

Allowed extensions: `.pdf .jpg .jpeg .png .heic .docx .xlsx`. Allowed MIME types are validated independently against the same set. Per-file limit: 25 MB. Files stored under `/InventoryApp/orders/<orderId>/<uuid>-<sanitized>`. Filename sanitization mirrors `sanitizeFilename()` in `src/api/imageOperations.ts:8`.

### `InventoryItem` change — add `unitOfMeasure`

Add `unitOfMeasure: string` to `InventoryItem`, `ItemCreateData`, and `ItemUpdateData`. Schema changes:

- `ItemCreateDataSchema`: `unitOfMeasure: z.string().min(1).default('each')`. Old `item-create` transactions replay with `'each'` injected — safe because creation defines the initial value.
- `ItemUpdateDataSchema`: `unitOfMeasure: z.string().min(1).optional()` with **NO default**. `deriveInventory()` merges update payload fields into the item at `src/utils/deriveState.ts:94`; if a default were applied, replaying an old `item-update` would inject `'each'` and silently overwrite a previously-set UoM. Optional-without-default makes the field absent in the parsed payload, so `Object.fromEntries(...filter v !== undefined)` in `deriveState.ts:96` skips it correctly.

In `deriveInventory()`, the `item-create` branch reads the (now defaulted) `unitOfMeasure` field. Surfaces affected:

- `src/mock/data.ts` — add `unitOfMeasure` to mock items
- `src/pages/NewItem.tsx` — UoM input
- `src/pages/ItemDetail.tsx` — display + edit. **Important:** because `ItemUpdateDataSchema` validates `unitOfMeasure` as `z.string().min(1).optional()`, the edit form must convert empty-string back to `undefined` before submitting (otherwise editing any other field on an item with the UoM input bound to `''` will fail Zod with "String must contain at least 1 character"). The submit handler does `unitOfMeasure: form.unitOfMeasure?.trim() || undefined`. Same treatment for any other `string().min(1).optional()` field on the form.
- `src/pages/InventoryList.tsx` — optional column
- CSV import (`src/pages/Import.tsx`) — optional column with `'each'` default
- CSV export (`src/pages/Export.tsx`) — include in template
- README docs section "CSV Columns"

## Storage paths

`src/api/paths.ts` gains:

```ts
export function getOrdersFolderPath(): string {
  return `${getBasePath()}/orders`;
}
export function getOrderFolderPath(orderId: string): string {
  return `${getBasePath()}/orders/${orderId}`;
}
export function getOrderFilePath(orderId: string, filename: string): string {
  return `${getBasePath()}/orders/${orderId}/${filename}`;
}
```

`src/api/bootstrap.ts` gets a step parallel to the existing `images/` creation (`src/api/bootstrap.ts:28`): create `/InventoryApp/orders/` if missing, with the same 409/412 race tolerance.

**Per-order subfolders are explicitly created**, not relied on as implicit. `attachmentService.ts` exposes `ensureOrderFolder(orderId)` that POSTs to the `orders/` children URL with `name: orderId, folder: {}, '@microsoft.graph.conflictBehavior': 'fail'`. Same race tolerance as `images/`. Called once per order before the first attachment upload (caller deduplicates within a save flow).

## API additions

### Service return type

Both `appendTransaction()` (existing, `src/api/transactionService.ts:36`) and the new `appendTransactions()` are changed to return:

```ts
type WriteResult = {
  transactions: Transaction[];
  items:        InventoryItem[];
  orders:       Order[];
};
```

instead of returning just `InventoryItem[]`. This lets `InventoryContext` update all three from one call without a follow-up read. The change is contained: `appendTransaction()` is currently called only by test fixtures and the unused `useInventoryData` hook, so updating the signature is low-risk.

### `appendTransactions(inputs[])` — batch atomic write

New helper in `src/api/transactionService.ts` alongside the existing `appendTransaction()`. Same shape as `appendTransaction`'s retry/ETag loop, with three changes documented below: **input identity is frozen before the loop**, **retries use exponential backoff with jitter**, and **staged validation is incremental, not O(N²)**.

**Input identity is frozen before the retry loop.** All UUIDs (`tx.id`, stub item `id`, stub item `sku`) are generated by the CALLER before `appendTransactions` is invoked, and are NEVER regenerated inside the retry loop. The plan's idempotency rules assume input is stable across retries — without this, a 412 retry that re-rolls a stub `sku` (after a collision detected against newly-read state) would produce a different `item-create` payload, breaking the "full-match no-op" path. **SKU collision policy:** if the caller's pre-rolled `sku` collides with a SKU already in the log when the staged loop checks `validateItemCreate`, throw a `StubSkuCollisionError` rather than re-roll. The 24-bit space (`SKU-<6 hex>`) makes collision astronomically unlikely; surface it to the user for the rare case rather than retry silently.

**Retry/backoff strategy.**

```ts
const MAX_RETRIES = 6;                 // existing const lifts from 3 → 6 for batch writes
const BASE_DELAY  = 50;                // ms
// On 412:
await sleep(BASE_DELAY * 2 ** attempt + Math.random() * BASE_DELAY);
```

This is jittered exponential backoff (50, ~110, ~250, ~550, ~1150, ~2350 ms). Without backoff the existing `while (retries <= MAX_RETRIES)` (`transactionService.ts:41-79`) ping-pongs through ETag conflicts in <100 ms under contention and exhausts retries before any natural staggering can resolve them. The cap of 6 attempts puts the worst-case wall time at ~5 seconds, surfaced to the user as a transient conflict error with a "Try again" button. `appendTransaction()` (single-input) gets the same backoff treatment — it's a strict win.

**Sequential staged validation, incremental.** Intra-batch dependencies must be enforced (e.g., a quick-add `item-create` must be visible to the subsequent `order-create`'s line-item check). Naive `deriveInventory(stagedLog)` per input is O(N²) on the full log; for a 50-line receive against a 5,000-tx log that's ~250k replay-steps × retries — browser-jank territory. Instead, derive base state ONCE and incrementally apply each staged input.

```ts
let stagedItems  = deriveInventory(log.transactions);
let stagedOrders = deriveOrders(log.transactions);

for (const input of inputs) {
  parseTransactionInput(input);                               // Zod parse — see "input parsing" below
  validateTransaction(input, stagedItems, stagedOrders);      // business rules
  ({ items: stagedItems, orders: stagedOrders } =
    applyTransaction(input, stagedItems, stagedOrders));      // pure incremental update
}
```

`applyTransaction(input, items, orders)` is a new pure helper extracted from the inner switch of `deriveInventory`/`deriveOrders` — it returns the post-input `{ items, orders }` without re-replaying. A perf test exercises N=50 lines on a 10k-transaction log and asserts <100 ms total validation time.

**Input parsing — defense in depth.** `parseTransactionInput(input)` runs `TransactionSchema.parse(...)` (with synthetic `performedBy` / `timestamp` if not yet stamped) before business-rule validation. Today the existing `appendTransaction()` only validates business rules — Zod parsing happens at READ time (`fileOperations.ts:38`). A buggy `orderService` could write a TS-typed but Zod-invalid payload that then fails parse on the next read for everyone. Parsing on write closes that gap. Add to test list.

`validateTransaction()` (`src/api/transactionService.ts:87`) signature is extended to accept `(input, items, orders)`. New cases for `order-create` / `order-receive` / `order-cancel` consult `orders` for preconditions like "target order exists and is `placed`", "PO# is not in use by a non-cancelled order", "all line items resolve to existing inventory items at this point in the batch".

**Idempotency rules** (precise):

- **Pre-input duplicate-id check.** If two inputs in the batch share an `id`, throw `DuplicateInputIdError` immediately (programmer error).
- **Full-match no-op.** If ALL input IDs already exist in the persisted log AND the persisted transactions match the inputs (same `type`, `itemId`, `data`), return the current derived state without writing — this is the idempotent retry path. Relies on the frozen-identity rule above.
- **Partial overlap.** If a STRICT SUBSET of input IDs exist in the log, throw `BatchPartiallyCommittedError`. Caller decides whether to surface as a conflict or retry with new IDs.
- **Mismatched id reuse.** If an input ID exists in the log but with different `type`/`itemId`/`data`, throw `IdReuseError`.

ETag conflicts (412) re-trigger the entire validate-and-stage loop with the freshly-read log AND the backoff sleep above.

### `orderService.ts` — new file

```ts
createOrder(input: OrderCreateInput): Promise<Order>      // 1 order-create + N item-create (for quick-add)
receiveOrder(orderId, input: OrderReceiveInput): Promise<Order>  // 1 order-receive + N stock-in (zero-qty lines skipped)
cancelOrder(orderId, note?): Promise<Order>               // 1 order-cancel
listOrders(): Order[]                                     // returns deriveOrders(currentTransactions)
getOrder(orderId): Order | null
findLatestLineItemForItem(itemId): OrderLineItem | null   // for autofill
```

`createOrder` and `receiveOrder` both use `appendTransactions()` to commit multiple events atomically. Quick-added items have `item-create` transactions emitted in the same batch BEFORE the `order-create`, so the `order-create` validation (which checks all `lineItems[].itemId` exist) sees them.

### `attachmentService.ts` — new file

```ts
ensureOrderFolder(orderId: string): Promise<void>
uploadOrderAttachment(orderId: string, file: File, stage): Promise<OrderAttachment>
deleteOrderAttachment(orderId: string, filename: string): Promise<void>
getOrderAttachmentUrl(orderId, filename): Promise<string>
```

Mirrors `src/api/imageOperations.ts`: sanitize, prefix uuid, PUT to SharePoint, return metadata. `ensureOrderFolder` is called by the upload flow before the first PUT to a given order; subsequent uploads in the same flow skip it via a per-flow `Set`. `deleteOrderAttachment` is used for cleanup on form cancel and admin removal.

## User flows

### Flow A — Place a new order

1. User navigates to `/orders/new`.
2. Fill PO header: PO# (required, unique), confirmation# (required), supplier (autocomplete from existing inventory suppliers), expected delivery (optional).
3. **Order docs** section (optional): drag/drop area. Files are kept in browser memory (not uploaded yet) — see "Attachment lifecycle" below.
4. Add line items one row at a time:
   - **Item picker:** typeahead search on existing inventory by name/SKU.
   - On selecting an existing item: `findLatestLineItemForItem(itemId)` autofills `name`, `unitOfMeasure`, `unitCost`, `quantityOrdered`. **Searches only non-cancelled orders** (`status !== 'cancelled'`) — autofilling from a cancelled order's typo'd qty/cost would propagate the same mistake the user just cancelled. If no prior non-cancelled order exists for this item, fall back to the item's `unitCost` and `unitOfMeasure`.
   - On "+ Create new item" (no match): inline mini-form with **name**, **unit of measure**, **unit cost**. App generates a stub `ItemCreateData` with these defaults to satisfy the existing `ItemCreateDataSchema`:
     - `sku`: `SKU-<6 random hex>` (rolled ONCE before the save batch enters the retry loop; a collision against the post-batch staged log is surfaced as `StubSkuCollisionError` rather than silently re-rolled — see "Input identity is frozen before the retry loop" above)
     - `quantity`: 0
     - `location`: `'Unspecified'`
     - `category`: `'Uncategorized'`
     - `supplier`: PO's supplier
     - `vendor`: PO's supplier
     - `referenceNumber`: PO's PO number
     - `reorderPoint`: 0
     - `unitCost`: as entered on the line
     - `unitOfMeasure`: as entered on the line
     - `isStub: true` — see "Stub items in the inventory list" below
     The user can refine these on `/inventory/:id` later. Any newly-created stub items are emitted as `item-create` transactions in the same atomic batch as `order-create`.
5. User edits qty/cost per line freely. Live total at bottom.
6. Save → upload all staged attachments (see lifecycle below) → call `createOrder` → `appendTransactions([...itemCreates, orderCreate])`.

### Flow B — Receive an order

1. From `/orders/:id`, user clicks "Receive" on a `placed` PO.
2. Receive form (sub-route or modal) shows each line with: ordered qty, editable **received qty** (defaults to ordered, may be 0), **lot #** (required iff received qty > 0), **expiration date** (required iff received qty > 0).
3. **Receive docs** section (optional): drag/drop area, kept in browser memory.
4. Submit:
   - Upload staged receive-stage attachments.
   - Build the transaction batch:
     - 1× `order-receive` carrying `receivedLines[]` and `attachments[]`.
     - For each line with `quantityReceived > 0`: 1× `stock-in` against `lineItems[i].itemId`, carrying `quantity`, `lotNumber`, `expirationDate`, and `orderId` for traceability.
     - Lines with `quantityReceived === 0` emit no `stock-in`.
   - Call `appendTransactions(batch)` — single ETag cycle.
5. After commit, `deriveOrders` shows status `received`, `actualReceiveDate` set; `deriveInventory` shows new batches.

Receive is single-event: one click closes the PO. No partial-receive-across-multiple-events.

### Flow C — Cancel an order

`placed` POs only. Confirmation modal. Emits a single `order-cancel` transaction. No stock changes.

## Attachment lifecycle (orphan-free)

The naive approach — uploading on file drop, before the order is saved — leaks files when the user cancels or validation fails. Instead, files transition through three states: **staged → uploaded → committed**. Cleanup is required at every transition where a file is abandoned.

1. **Staged (in memory).** When the user adds a file, keep the `File` object in component state. Show in the UI as a chip with name, size, ✕ remove. No SharePoint call yet. **De-duplication:** before adding a new staged file, check the existing staged + uploaded lists for an entry with the same `name` AND `size` (cheap heuristic, no hashing). If a match is found, prompt: *"This looks like the same file you already added. Replace, keep both, or skip?"* — default to "Skip". Avoids accidental double-uploads when users drag a file twice.
2. **Upload phase (on Save click).** Generate `orderId` upfront so paths are stable. Sequentially upload all staged files via `uploadOrderAttachment(orderId, file, stage)`, calling `ensureOrderFolder(orderId)` once before the first upload. As each completes, move it to an `uploadedAttachments` list in component state. On per-file upload failure: show inline error, leave already-uploaded files in the uploaded list, let the user retry/remove the failed file. The order transaction is NOT committed yet.
3. **Commit phase.** Once all files are in `uploadedAttachments`, call `appendTransactions(...)` with the order transaction(s) that reference those filenames.
4. **Cleanup triggers** — any of these abandons the in-flight upload state and must DELETE the `uploadedAttachments` files (best-effort, fire-and-forget):
   - **User clicks Cancel** on the form.
   - **Commit fails** (`appendTransactions` throws after exhausting retries). The user is shown the error with two buttons: "Retry" (re-attempts commit using the same uploaded files) and "Discard" (cleanup + close form). On unmount-before-decision, default to Discard.
   - **Component unmount or navigation away** without an explicit Cancel/Retry decision — `useEffect` cleanup fires DELETE for `uploadedAttachments`.
   - **Tab close / page refresh** — best-effort and explicitly NOT relied on. Implementation: a `beforeunload` AND `pagehide` listener (the latter for Safari/iOS) fires `fetch(graphDeleteUrl, { method: 'DELETE', headers: { Authorization: 'Bearer ' + cachedToken }, keepalive: true })` for each `uploadedAttachments` entry — but ONLY if a non-expired access token is already in MSAL's in-memory cache (checked via `acquireTokenSilent` with a synchronous-only fast path; if that would require iframe/popup/redirect, we skip). MSAL has no public sync API for "is there a token without I/O", so the implementation tries `acquireTokenSilent({ forceRefresh: false })` synchronously and treats any awaited promise resolution after the unload as a no-op. The `keepalive` flag has a 64 KB body cap which is not a concern for DELETE. **Tab close cleanup is documented as a courtesy, not a guarantee.**
   - **Logout** — if the user signs out while files are in `uploadedAttachments`, the auth context evaporates and DELETE will fail. Treat the same as tab-close: best-effort, no error to user, admin pruning catches it.

The canonical fallback for orphaned files is **admin pruning**. Bundled with this feature:

- **`scripts/prune-order-attachments.ts`** (new file) — a Node script intended to run from a maintainer's terminal, not in the browser. Reads `transactions.json` via Graph, derives the set of valid `orderId`s via `deriveOrders`, lists all subfolders under `/InventoryApp/orders/`, and DELETEs any folder whose `orderId` is not in the valid set. Prints a dry-run report by default; `--apply` actually deletes. Documented in README under "Maintenance".
5. **Receive flow:** same lifecycle, but uploads go into the existing order's folder; `ensureOrderFolder(orderId)` is still called (idempotent) in case the placement flow had no attachments.

Once a transaction is committed, the files are referenced by the persisted log and must NOT be deleted by this lifecycle — they're the source of truth for the order's attachments going forward.

## UI

### Navigation
New "Orders" link in the top nav (`src/App.tsx` NavBar), between "Stock In/Out" and "Import".

### Routes (`src/App.tsx`)
- `/orders` — list page
- `/orders/new` — create form
- `/orders/:id` — detail page
- `/orders/:id/receive` — receive sub-route (also available as a modal trigger)

### `InventoryContext` integration

The current `src/context/InventoryContext.tsx` is mock-backed in BOTH dev and SharePoint modes — it initializes `transactions` and `items` from `mockItems` / `mockTransactions` at `src/context/InventoryContext.tsx:48` regardless of MSAL state. This is invisible today because nothing else writes to SharePoint. Once orders go through `appendTransactions`, the context's `items` (sourced from mocks) and the SharePoint transaction log diverge: a line item picked from the form's mock-backed list has an ID that doesn't exist in the persisted log, so `validateTransaction()` rejects it.

**Fix (must land before order mutations are wired to Graph):** introduce a SharePoint-mode bootstrap in `InventoryContext`:

1. On provider mount, if MSAL is configured, call `initializeDataStore()` then `readTransactionLog()`.
2. Set `transactions` from the loaded log; derive `items` via `deriveInventory(transactions)` and `orders` via `deriveOrders(transactions)`.
3. Mock data is used only when MSAL is NOT configured (dev mode), gated by the same `msalConfigured` boolean used in `AuthGate`.
4. **Service return contract.** `appendTransaction()` and `appendTransactions()` are changed to return `{ transactions: Transaction[]; items: InventoryItem[]; orders: Order[] }` instead of just `InventoryItem[]`. The context replaces all three from this return value. Existing call sites of `appendTransaction()` are updated (today there are none in production code paths — the function is exercised only by tests and the unwired `useInventoryData` hook, so the breaking change is contained).

Existing synchronous item/stock context methods are kept for dev mode; in SharePoint mode they delegate to `appendTransaction()` (turning the call site into an async one — the affected pages are listed in the impl order so they can be migrated together).

Context surface gains:

```ts
orders: Order[];
createOrder(input): Promise<Order>;
receiveOrder(id, input): Promise<Order>;
cancelOrder(id, note?): Promise<Order>;
findLatestLineItemForItem(itemId): OrderLineItem | null;
```

**`useInventoryData` removal.** `src/hooks/useInventoryData.ts` exists but has no callers (verified via grep against the worktree). The new bootstrap subsumes its responsibility. We DELETE the hook in step 0a rather than "leave it alone" — keeping it creates dead code that looks reachable to a future reader and could drift out of sync with the bootstrap. Tests covering the hook (if any) are deleted with it.

### `/orders` — list
Table: PO#, supplier, order date, expected delivery, status badge, line count, total $. Filters: status, supplier, date range. Search: PO# or confirmation#. "+ New Order" top-right.

### `/orders/new` — create
Header (PO#, conf#, supplier autocomplete, expected delivery), Order docs upload, line items rows, live total, Save / Cancel.

### `/orders/:id` — detail
Read-only PO header + status badge. Line item table (incl. qty received, lot, expiration when received). Attachments split: "Order docs" + "Receive docs" with download links. Action buttons by status: `placed` → Receive / Cancel / **"Edit (cancels original on save)"** (the button label is explicit about the consequence to avoid the abandonment trap — opens the recreate form with a banner reiterating that closing the tab without saving leaves the original active); `received` and `cancelled` → no actions. Activity timeline of related transactions.

### `/orders/:id/receive` — receive
Editable received qty / lot / expiration per line; receive docs upload; Confirm.

### Dashboard additions
- **Open Orders** card — count of `placed` POs, links to filtered list.
- **Overdue Orders** callout — `placed` POs whose `expectedDeliveryDate` < today. **Mock data note:** if the orders feature is exposed in dev mode, `src/mock/data.ts` mock orders compute `expectedDeliveryDate` as `today + N days` at module load (using a small helper `daysFromToday(n)`), NOT hardcoded ISO strings. Hardcoded mock dates will become "overdue" the day after a commit and pollute the dashboard for every dev who pulls.

### Activity feed updates (`src/pages/Dashboard.tsx`)
The current activity feed at `src/pages/Dashboard.tsx:101` only renders item/stock transaction types and falls through to a no-render default for unknown types. Order events would otherwise appear blank. Three updates:

1. **Move `tx.data` casts inside each `case`.** Today `renderText()` reads `(tx.data as StockData).quantity` and `(tx.data as StockData).note` UNCONDITIONALLY at `src/pages/Dashboard.tsx:120-121`, BEFORE the switch. This works by accident for current types because `quantity` happens to be a property of `ItemCreateData` too, but adding `order-*` types newly exposes the bug: `OrderCreateData.quantity` doesn't exist (only `lineItems[i].quantityOrdered`), and the `note` cast on `OrderCreateData` would read undefined or worse if a future schema change shifts the field. The fix is independent of the order rollout but MUST be done in the same step: each `case` extracts the data it needs (`const d = tx.data as StockData;` inside the case), the unconditional reads at lines 120-121 are removed.
2. Extend `typeConfig` (`src/pages/Dashboard.tsx:105`) with entries for `order-create`, `order-receive`, `order-cancel` (icons + class).
3. Extend `renderText()` (`src/pages/Dashboard.tsx:118`): for order-* events, look up the order via `orders.find(o => o.id === tx.itemId)` instead of `items.find` (since `tx.itemId` is the order's UUID for these types). Render messages like *"Placed PO-2026-0101 to Qiagen — 3 lines"*, *"Received PO-2026-0101 — 3 batches added"*, *"Cancelled PO-2026-0101"*.

`stock-in` rows emitted from a receive event continue to render normally; if `tx.data.orderId` is present, append `"(via PO-...)"` for traceability.

## Permissions & threat model

Matches existing inventory model:
- All authenticated users: create, edit, receive, cancel orders; upload/delete attachments on placed orders.
- Admin only (client-side enforcement, same as existing CSV import): delete attachments from `received` or `cancelled` orders. Enforced via the same `isAdmin()` gate used for import.

**Threat model — explicit acknowledgement.** Permissions above are **UX gates, not security boundaries**. Any authenticated user holds a Graph token with `Sites.ReadWrite.All` scoped to the configured SharePoint site (per `src/auth/msalConfig.ts`'s `loginScopes`). They could bypass the UI and directly DELETE any file under `/InventoryApp/orders/...`, or PUT a doctored `transactions.json` with someone else's `performedBy` email. The intended user population is a 5-person biolab team, all with similar trust level — matching the threat model the existing `transactions.json` design already accepts. If a future deployment needs hardened multi-tenant isolation, that requires per-folder SharePoint permission splits and a backend signing layer; both are explicitly out of scope (listed in YAGNI).

## Validation (Zod + business rules)

- `poNumber`: non-empty, trimmed, **unique across non-cancelled orders** (checked at save against `deriveOrders(transactions)`). PO numbers from cancelled orders are released and may be reused — this enables the v1 "edit = cancel + recreate" workflow without forcing the user to mint a new number.
- `orderConfirmationNumber`: required, non-empty.
- `supplier`: required.
- At least one line item required.
- Per line: `quantityOrdered > 0`, `unitCost >= 0`, `name` non-empty, `unitOfMeasure` non-empty.
- Receive per line: `quantityReceived >= 0` integer; `lotNumber` non-empty AND `expirationDate` parseable IFF `quantityReceived > 0`. **Past expiration:** if `expirationDate < today`, the receive form shows an inline warning *"Lot expires before today — record reason"* and reveals an optional `pastExpirationReason` text field. The reason (if entered) is stored on the `OrderReceiveData.receivedLines[i].pastExpirationReason` field for compliance audit. Submitting with an empty reason is allowed but logged as `"(none provided)"`. Schema: `pastExpirationReason: z.string().optional()` on the per-line shape.
- Attachments: extension AND MIME both in allowed set; `sizeBytes <= 25 MB`. Reject before upload begins.
- New `order-*` transactions enforced by Zod discriminated union; existing `validateTransaction()` switch in `transactionService.ts:87` extended with `order-create` (validates header + line items + ensures all `lineItems[].itemId` resolve), `order-receive` (validates target order is `placed`; received lines map to existing line ids), `order-cancel` (validates target order is `placed`).

## Edge cases

- **Short-receive** (received < ordered, > 0): allowed, recorded as-is. Order moves to `received`. Detail shows `"7 of 10 received"`.
- **Zero-receive** (received === 0): allowed; line emits NO `stock-in`; `lotNumber`/`expirationDate` not required for that line.
- **Over-receive** (received > ordered): allowed with confirmation prompt. Recorded as-is.
- **Editing a placed order:** v1 has NO direct edit. The detail page exposes a "Cancel & Re-create" button on `placed` POs that pre-fills `/orders/new` with the current PO's data (including the PO# — reusable since the predecessor will be cancelled) and emits the cancel + recreate as a single `appendTransactions` batch when saved. The cancel transaction's `note` is auto-filled with `"Replaced by PO-<new-po-number>"` and `replacedBy` carries the new order's UUID. The recreate form shows a banner: *"Editing PO-2026-0101 — saving will cancel the original and create a replacement. Closing this tab without saving leaves the original active."* (Avoids adding an `order-update` event type for v1; revisit if users hit friction.)
- **Cancel & Re-create — concurrent PO# race:** if another user places PO-100 in the gap between the user clicking "Cancel & Re-create" on their own PO-100 and clicking Save, the recreate's batch fails the staged-validation PO# uniqueness check (since the new PO-100 is now active and uncancelled). Surfaced to the user as: *"PO-100 was just claimed by someone else. Pick a new number or cancel this edit."* Test case in `appendTransactions.test.ts`.
- **Stub items in the inventory list:** quick-add stubs default to `quantity: 0`, `location: 'Unspecified'`, `category: 'Uncategorized'`, and a new `isStub: boolean` flag set by the `item-create` payload. Add `isStub` to `InventoryItem`, `ItemCreateData`, and `ItemUpdateData` (the latter is how the user "graduates" a stub by editing the placeholders — saving real `location`/`category` flips `isStub` to `false`). `ItemUpdateDataSchema` validates `isStub: z.literal(false).optional()` (only forward graduation; cannot manually re-stub). `/inventory` and the dashboard's low-stock alert filter out `isStub === true` by default; the list page gets a "Show stubs (N)" toggle. Stubs with positive quantity (received against a still-stub item) flip `isStub` to `false` automatically in `deriveInventory` since `'Unspecified'` location / 0 reorder point are no longer accurate signals.
- **Stub items from a cancelled order:** stay in inventory with qty 0. Visible only via the "Show stubs" toggle. User deletes manually. Not auto-cleaned.
- **Concurrent edits / conflict:** existing `appendTransaction` retry loop handles 412 by re-deriving and re-validating. `appendTransactions` does the same. PO# uniqueness is re-checked after retry, so a concurrent PO# can be detected.
- **Attachment upload failure mid-save:** see "Attachment lifecycle" — staged files retried independently; order commit happens only after upload phase resolves.
- **Cancelled order with attachments:** files stay on SharePoint and remain accessible from the detail page.
- **Empty order folder when all attachments are removed before commit:** if a user adds attachments, uploads them, then removes them all (each cleanup deletes the file), the per-order folder created by `ensureOrderFolder()` may be left empty. The pruning script (`scripts/prune-order-attachments.ts`) handles this — empty folders for unknown order IDs are removed in the same pass. Not blocking; folders are cheap.

## Testing (Vitest, follows existing patterns under `src/**/__tests__/`)

- Schema validation: `OrderCreateData`, `OrderReceiveData`, `OrderCancelData` accept valid shapes, reject invalid (e.g., `quantityOrdered <= 0`, missing lot when `quantityReceived > 0`, empty `receivedLines`, mismatched line ids between receive and target order).
- `deriveOrders.test.ts`: replay sequences produce expected order state for create / receive / cancel. Out-of-order or duplicate events are tolerated (idempotency). Defensive ignore: `item-*` referencing an order's UUID is logged and skipped; `order-*` referencing an unknown id same.
- `deriveState.test.ts` invariant test: order ID set ∩ item ID set = ∅ on a representative log; intentional collision fixture verifies defensive-ignore path.
- `appendTransactions.test.ts`: atomic batch write; 412-retry with backoff (mock the sleep); sequential staged validation (intra-batch dependencies enforced); incremental `applyTransaction` matches `deriveInventory(stagedLog)` on a 100-event fixture; perf test asserts <100ms validation on 50-line receive against a 10k-tx log; idempotency cases — full-match no-op, partial-overlap throws `BatchPartiallyCommittedError`, intra-batch duplicate id throws `DuplicateInputIdError`, mismatched-id-reuse throws `IdReuseError`; **identity-frozen test** — simulate 412 conflict, assert all `id` and `sku` values in retry attempt match the first attempt; **Zod parse on write** — TS-typed but Zod-invalid input is rejected before write (e.g. malformed UUID, extra unknown key); **Cancel & Re-create race** — a concurrent placement of the same PO# between read and write fails the recreate's batch and surfaces a clear error.
- `orderService.test.ts`: create (with and without quick-add items), receive (full / short / zero / over per line), cancel. Verify `stock-in` emissions match non-zero received lines and that batches land on correct items via `deriveInventory`. Cancel & Re-create as one batch reuses PO#; `replacedBy` and `note` populated on the cancel transaction.
- `findLatestLineItemForItem.test.ts`: returns the most recent line from a non-cancelled order; returns null if all matching orders are cancelled; returns null with no prior orders.
- `validation.test.ts`: receive validation (lot/exp required gating on received qty); empty `receivedLines` rejected; past expiration warning + optional reason field.
- `unitOfMeasure` migration: replaying old `item-create` transactions defaults to `'each'`; replaying old `item-update` transactions does NOT inject `unitOfMeasure` (preserves the previously-set value); new transactions persist user-selected value; CSV import treats column as optional. **`ItemDetail` form test:** submit with `unitOfMeasure: ''` — handler converts to `undefined` before submit, schema accepts.
- `Dashboard.test.tsx`: order events render correct text; cast-inside-case refactor — replaying a fixture with mixed transaction types does not throw on the unconditional-read removed at line 120-121; `isStub` items hidden by default with toggle to show them.
- Attachment validation: rejects oversized, disallowed ext, mismatched MIME; de-duplicates on `name + size`.
- Attachment cleanup: on commit-failure path, uploaded files are DELETEd (best-effort); on user Cancel, uploaded files are DELETEd; on form unmount without explicit decision, cleanup fires; logout fires the same cleanup path; tab-close best-effort attempt is documented and tested with a mocked `pagehide`/`beforeunload` listener (assertion: cleanup is queued, not awaited).
- Bootstrap: `/orders/` folder creation tolerates 409/412; `ensureOrderFolder` is idempotent across repeated calls in one flow.
- `InventoryContext` bootstrap: in mock mode (no MSAL config), context loads mocks; in SharePoint mode, context derives state from `transactions.json` and `mockItems`/`mockTransactions` are NOT read; `useInventoryData` is removed (build fails if any caller is added later).
- `scripts/prune-order-attachments.ts`: dry-run lists folders that would be deleted; `--apply` only deletes folders whose `orderId` is absent from `deriveOrders(log)`; tolerates concurrent writes (re-reads and skips folders that became valid mid-run).
- **Production-caller assertion (step 0a):** automated check (`scripts/check-no-old-write-result.ts` or a unit test) greps `src/` for any reference to the OLD `appendTransaction()` return-shape (`Promise<InventoryItem[]>`) and fails the build if found.

## Out of scope (YAGNI)
- Multi-lot per line at receive time
- Partial receives across multiple events
- PO templates / favorites
- Email notifications
- PO PDF export
- Per-folder SharePoint permission splits for attachments
- An `order-update` transaction type (v1 uses cancel + re-create for edits)

## Implementation order (suggested)

0. **Unify MSAL** (pre-req). Refactor so a single `PublicClientApplication` is initialized once and reused by `transactionService`. Verify via a smoke test that `appendTransaction` works end-to-end against SharePoint when MSAL is configured.
0a. **SharePoint-mode `InventoryContext` bootstrap** (pre-req). On provider mount in MSAL-configured mode, run `initializeDataStore()` + `readTransactionLog()` and derive `items`/`orders` from the log instead of using mocks. Migrate the existing item/stock mutator methods to delegate to `appendTransaction()` in SharePoint mode (turning callers async — the touched pages are NewItem, ItemDetail, StockForm, Import). **Delete `src/hooks/useInventoryData.ts`** (no callers, dead code). Add the production-caller assertion (`scripts/check-no-old-write-result.ts` or a CI grep) so anyone reintroducing the old return shape is caught. Mock-mode behavior unchanged. Standalone PR-shaped step.
0b. **Retry/backoff + Zod-on-write hardening** (pre-req). Add jittered exponential backoff to `appendTransaction`'s retry loop (`MAX_RETRIES` 3 → 6, base delay 50ms × 2^attempt + random jitter). Add `parseTransactionInput()` that runs `TransactionSchema.parse(...)` before business validation. Tests for both. Lands before `appendTransactions` because it shares the loop body.
0c. **`Dashboard.tsx` activity feed safety refactor** (pre-req for step 5). Move the `tx.data` casts inside each `case` of `renderText()` (lines 120-121); remove the unconditional `(tx.data as StockData).quantity` and `.note` reads. No behavior change for existing transaction types; unblocks safe addition of order types in step 5.
1. `unitOfMeasure` field rolled out across model, schemas (create has `.default('each')`, update has `.optional()` with NO default), derive, mock, NewItem/ItemDetail/InventoryList (with empty-string→undefined submit shim), CSV import/export. Tests + docs. *(Touches the most files; standalone.)*
1a. `isStub` field rolled out: add to `InventoryItem`, `ItemCreateData`, `ItemUpdateData`, schemas (update is `z.literal(false).optional()`), `deriveInventory` graduation logic, `InventoryList` "Show stubs" toggle, dashboard low-stock filter excludes stubs. Tests.
2. Transaction model: add `order-create` / `order-receive` / `order-cancel` types + Zod schemas (with `OrderReceiveDataSchema` per-line refinements; cross-schema `receivedLines.length === order.lineItems.length` check in `validateTransaction`). Extend `validateTransaction()` signature to `(input, items, orders)` and add cases for the new types. `appendTransactions()` helper with sequential incremental staged validation (`applyTransaction` helper extracted), frozen-identity rule, idempotency rules + tests (including the perf test on 10k-tx fixture).
3. `deriveOrders()` + `Order` types + `orderService` (create / cancel only at this stage) + `findLatestLineItemForItem` (filters non-cancelled) + tests. Defensive-ignore branches in derivers.
4. `/orders` list, `/orders/new`, `/orders/:id` (without attachments, without receive). End-to-end flow for placed POs. Activity feed renders `order-create` / `order-cancel`. Mock orders use relative dates (`daysFromToday(n)`) if exposed in dev mode.
5. Receive flow: `receiveOrder` in service, `/orders/:id/receive` form, dashboard "Open Orders" + "Overdue Orders" cards. Activity feed gains `order-receive` rendering and `(via PO-...)` traceability suffix on stock-in rows. Past-expiration warning + optional reason field.
6. Attachments: `bootstrap.ts` adds `orders/` folder. `attachmentService.ts` (`ensureOrderFolder`, upload, delete, getUrl). Staged upload lifecycle in create + receive forms with name+size dedup, beforeunload+pagehide cleanup, logout cleanup. Detail page renders both buckets with download links. **`scripts/prune-order-attachments.ts`** ships in this step with README "Maintenance" docs.
7. Polish: "Edit (cancels original on save)" button + banner on detail page; supplier autocomplete; PO# uniqueness UX (concurrent-PO# race surfaces clear error); empty-receive guard messaging.
