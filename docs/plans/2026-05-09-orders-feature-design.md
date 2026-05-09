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

**Fix (must land before order mutations are wired to Graph):** keep `AuthGate.tsx` as the auth UI (it owns the LoginPage rendering, the loading state, the `cancelled` flag for unmount safety, and the error fallback at `AuthGate.tsx:91-100`). Move its `PublicClientApplication` construction up to a module-scope singleton, export it for `transactionService.ts`, and **delete `AuthProvider.tsx`** (its `MsalProvider` wrapper is dead — `App.tsx` doesn't use it).

Concrete shape:

```ts
// src/auth/msalInstance.ts (new shared module)
import { PublicClientApplication } from '@azure/msal-browser';
import { msalConfig } from './msalConfig';
export const msalInstance = new PublicClientApplication(msalConfig);
// (initialize() called from AuthGate's effect; transactionService imports the same singleton)
```

`AuthGate.tsx` imports `msalInstance` from this module (instead of constructing one locally), and its `useEffect` does `await msalInstance.initialize()` plus `handleRedirectPromise()` exactly as today. `transactionService.ts:14` keeps importing `msalInstance` but from the new path.

**Event-callback cleanup.** Today `AuthGate.tsx:60-72` calls `addEventCallback(...)` but never `removeEventCallback`. With React StrictMode in dev (which double-mounts effects), each remount registers another callback — they pile up. The refactored effect captures the return value of `addEventCallback(id)` and calls `msalInstance.removeEventCallback(id)` in the cleanup function. Production behavior is unchanged (one callback registered); dev/test no longer leak.

The earlier "either approach" wording was wrong: dropping `AuthGate` would lose its login-state UX and the unmount-safety wiring. There is one canonical fix; the alternative would ship a broken UI. Listed as Step 0 in the implementation order.

## Forward-compat: stale clients + rollback

`fileOperations.ts:38` does `TransactionLogSchema.parse(raw)` on every read. Once new code commits an `order-*` transaction, an older bundle (cached JS, stale tab, emergency rollback) will reject the entire log because the discriminated union is closed — the app dies on load with `DataLossError`. GitHub Pages serves `index.html` with default cache headers and Vite-hashed chunks live a long time in open tabs, so this is a real-world hit.

**Fix:** change the log-level Zod parse to be tolerant of unknown transaction types.

```ts
// schemas.ts
export const TransactionLogSchema = z.object({
  schemaVersion: z.literal(2).optional(),  // present iff written by new code
  transactions: z.array(z.unknown()),       // shallow at this layer
});
// Per-transaction parse uses TransactionReadSchema.safeParse(...) on each element;
// failures are logged and the element is dropped from the in-memory log
// (so an old bundle reading new entries shows current inventory MINUS orders
// rather than crashing).
```

Old bundles continue to read inventory normally; orders simply don't exist in their view of the world (consistent with their lacking the UI for orders anyway). When the user reloads, they get the new bundle and the orders reappear. New code reading a `schemaVersion: undefined` log treats it as v1 and continues normally.

`appendTransaction` / `appendTransactions` always WRITE `schemaVersion: 2`. A v1 reader on a v2 file does not break (the `schemaVersion` field is unknown/ignored at the array level). A v2 reader on a v1 file (no field) treats it as v1.

## Architecture: event-sourced, not file-based

The existing app is event-sourced: `transactions.json` is the SOLE source of truth, and `deriveInventory(transactions)` rebuilds inventory state by replaying the log (`src/utils/deriveState.ts:52`). There is NO `inventory.json`. Orders follow the same model:

- **Orders are derived state.** A new `deriveOrders(transactions)` function replays `order-*` transactions and returns the current `Order[]`. No separate `orders.json` file. Cross-file atomicity is therefore not a concern.
- **`Order.attachments` derivation rule.** Naive concatenation in event order:
  ```
  Order.attachments = [
    ...orderCreate.data.attachments,    // each tagged stage: 'placed'
    ...orderReceive?.data.attachments,  // each tagged stage: 'received', if a receive event exists
  ]
  ```
  No de-duplication: each `OrderAttachment.id` is uuid'd, so even if a user uploads the same physical file at both stages it shows as two separate entries with different stages and ids. A future cancel event does NOT remove attachments. Test fixture: a sequence with attachments on both create and receive verifies both bucket sections render correctly on the detail page.
- **Three new transaction types** added to the existing discriminated union: `order-create`, `order-receive`, `order-cancel`.
- **Multi-event writes** (e.g. receive emits 1 `order-receive` + N `stock-in`) require a new `appendTransactions(inputs[])` helper that commits all of them in a single ETag cycle. Without this, partial network failure could leave inconsistent state.

## Date/time policy

All timestamps and dates are **stored in UTC** across the system. UI rendering and form input use the **user's browser timezone** for both display and entry — the browser handles the local↔UTC conversion via `Date` and `<input type="date">`/`<input type="datetime-local">` semantics.

- `Transaction.timestamp` — full ISO 8601 UTC, e.g. `2026-05-09T17:42:00Z`. Existing pattern from `transactionService.ts:60`.
- `Order.orderDate`, `Order.expectedDeliveryDate`, `Order.actualReceiveDate`, `OrderLineItem.expirationDate` — calendar dates only (`YYYY-MM-DD`), no time component, no timezone marker. These represent business dates (when something was placed/expected/received/expires); they don't shift with the viewer's timezone.
- The `daysFromToday(n)` mock helper returns `YYYY-MM-DD` (date-only string), computed as `new Date(Date.now() + n*86400000).toISOString().slice(0, 10)` — UTC-based truncation, matching the Overdue cutoff exactly. Using "browser locale" would create drift between mock dates and the dashboard's UTC-based comparison.
- Comparisons like "is `expectedDeliveryDate < today`?" (the Overdue Orders dashboard callout) are string-comparable because the format is ISO `YYYY-MM-DD`. `today` is computed once per dashboard render via `new Date().toISOString().slice(0, 10)`.
- Past-expiration check on receive uses the same `YYYY-MM-DD` comparison against today.

No external timezone library is added. The biolab team is co-located so multi-timezone correctness is not a concern; the policy is simple and defensible.

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
- `OrderCancelDataSchema` — `note?: z.string().optional()`, `replacedBy?: z.string().uuid().optional()`. **`replacedBy` is informational only** — it carries the replacement order's pre-rolled UUID for audit, no business-rule validation. Specifically: `validateTransaction` MUST NOT verify that `replacedBy` resolves to an existing order id, because the staged loop processes the cancel BEFORE the replacement order-create (see "Cancel & Re-create batch ordering" in Edge cases). A future implementer adding paranoid existence-check would break the flow.

These join the existing transaction discriminated union in `src/models/schemas.ts` (the `TransactionReadSchema` / `TransactionWriteSchema` split per step 0a-2).

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
| `id` | uuid | client-generated via `crypto.randomUUID()` at placement, included in the `OrderCreateData` payload, **stable across the order's lifecycle** (the receive form maps `receivedLines[i].id` against these). |
| `itemId` | string | links to `InventoryItem.id` |
| `name` | string | snapshot at order time |
| `unitOfMeasure` | string | `'each' \| 'box' \| 'kit' \| 'case'` or custom |
| `quantityOrdered` | number | `> 0` |
| `quantityReceived` | number \| null | derivation: `null` iff order status is `placed`/`cancelled`; explicit `number` (including `0` for zero-receive lines) iff status is `received`. Detail page distinguishes "0 of 10 received" from "— of 10 (not yet received)". |
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
- CSV import (`src/pages/Import.tsx`) — optional column with `'each'` default. Empty cells for any optional `string().min(1).optional()` field (such as `unitOfMeasure` on update-shaped rows) are converted to `undefined` BEFORE the schema parse, mirroring the same `value?.trim() || undefined` shim used in the ItemDetail edit form. Otherwise CSV blanks would Zod-fail the same way an empty form input does.
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

**Per-order subfolders are explicitly created**, not relied on as implicit. `attachmentService.ts` exposes `ensureOrderFolder(orderId)` that POSTs to the `orders/` children URL with `name: orderId, folder: {}, '@microsoft.graph.conflictBehavior': 'fail'`. Same race tolerance as `images/`. The save flow deduplicates calls to it via a per-flow `Set<string>` so multiple attachment uploads in one form share a single create attempt; subsequent flows (different page load, different user) make their own calls and rely on the 409 tolerance. The receive flow's first upload always calls it (idempotent) in case the placement flow had no attachments and the folder was never created.

## API additions

### `writeTransactionLog` — upload-session fallback for >4 MB bodies

Microsoft Graph's simple PUT (`/items/{id}/content`) caps the request body at 4 MB. At ~500 bytes/transaction, that ceiling is hit around 8,000 transactions. A 5-user / 5-year deployment with this feature crosses it (1,250 orders × 5 receive lines = ~6,250 stock-in events on top of base traffic, easily ≥10k total). The bug is dormant today and surfaces silently 1-2 years out — at which point every mutation fails atomically with `413 Request Entity Too Large`.

**Fix (lands in step 0b):** `writeTransactionLog` switches to an upload session when `Buffer.byteLength(body) > 4_000_000`:

```ts
const body = JSON.stringify(data, null, 2);
if (body.length <= 4_000_000) {
  return simpleput(url, body, eTag);   // existing path
}
// Upload session: POST /items/{id}/createUploadSession, then PUT chunks to the
// returned uploadUrl with Content-Range headers; the final chunk's response
// carries the new eTag. The session URL is unauthenticated (issued pre-signed),
// matching the existing two-step read pattern.
return uploadSessionPut(url, body, eTag);
```

The threshold is a literal 4_000_000 (not 4_194_304 = 4 × 1024²) per Graph docs. The session approach supports up to ~60 MB without further work, which buys the deployment another ~10 years at current growth. Compaction (snapshot + truncate-old-events) is the v2 follow-up if this ever becomes a real ceiling. Added to the test list.

### Service return type

Both `appendTransaction()` (existing, `src/api/transactionService.ts:36`) and the new `appendTransactions()` are changed to return:

```ts
type WriteResult = {
  transactions: unknown[];        // RAW array including any unknown stale-bundle entries; this is the value to persist for the next write-back
  known:        Transaction[];    // safeParse-passing entries only, for in-memory iteration / debugging
  items:        InventoryItem[];  // post-commit derived
  orders:       Order[];          // post-commit derived
};
```

instead of returning just `InventoryItem[]`. This lets `InventoryContext` update all four from one call without a follow-up read.

**`transactions` MUST be `unknown[]`** (the raw round-trip array), not `Transaction[]`. The next write-back appends to this array, preserving stale-bundle-written entries verbatim. Returning `Transaction[]` here would silently drop unknown entries on the next commit — directly contradicting the load-bearing rule under "Append target is `data.transactions` (raw)" below. The change is contained: `appendTransaction()` is currently called only by test fixtures and the unused `useInventoryData` hook, so updating the signature is low-risk.

### `appendTransactions(inputs[])` — batch atomic write

New helper in `src/api/transactionService.ts`. **`appendTransaction(input)` is reimplemented as `appendTransactions([input])`** — single source of truth for retry, backoff, staged validation, idempotency, frozen identity, AbortSignal, `parseTransactionInput`, and the raw-round-trip rule below. Without this consolidation, every behavior change (e.g., the H1 raw-round-trip rule, future MAX_RETRIES tweaks) has to be applied in two places. The existing public surface of `appendTransaction()` stays the same; its body becomes a one-liner.

Same shape as the prior single-input retry/ETag loop, with three changes documented below: **input identity is frozen before the loop**, **retries use exponential backoff with jitter**, and **staged validation is incremental, not O(N²)**.

**Append target is `data.transactions` (raw `unknown[]`), not `known`.** Both `appendTransaction(s)` write back `[...result.data.transactions, ...newTxs]` so unknown entries from stale-bundle origins are preserved byte-for-byte across the round-trip. Writing `[...known, ...newTxs]` would silently drop any `order-*` event when the new bundle's `appendTransaction` (serving `NewItem` / `ItemDetail` / `StockForm` / `Import` per step 0a) commits a stock-in — exactly the data-loss case the dual-array shape is designed to prevent. Apply this rule to BOTH single and batch paths (the consolidation above means it lives in one place).

**Input identity is frozen before the retry loop.** All UUIDs (`tx.id`, stub item `id`, stub item `sku`) are generated by the CALLER before `appendTransactions` is invoked, and are NEVER regenerated inside the retry loop. The plan's idempotency rules assume input is stable across retries — without this, a 412 retry that re-rolls a stub `sku` (after a collision detected against newly-read state) would produce a different `item-create` payload, breaking the "full-match no-op" path. **SKU collision policy:** if the caller's pre-rolled `sku` collides with a SKU already in the log when the staged loop checks `validateItemCreate`, throw a `StubSkuCollisionError` rather than re-roll. The 24-bit space (`SKU-<6 hex>`) makes collision astronomically unlikely; surface it to the user for the rare case rather than retry silently.

**Timestamp-stamping policy.** `appendTransaction` (single, `transactionService.ts:57-61`) stamps `performedBy` + `timestamp` per-tx. For batch writes, all inputs share **one commit timestamp** (the time the retry loop succeeds), and **derivers MUST treat array order as canonical** — no sort by timestamp. This keeps the per-batch atomicity story simple (one commit time per logical operation) and avoids the "monotonic micro-incremented timestamps" trap where future code might reorder same-timestamp txs unpredictably. Documented in `transactionService.ts` as a comment on the timestamping helper.

**Retry/backoff strategy.**

```ts
const MAX_RETRIES = 6;                 // existing const lifts from 3 → 6 for batch writes
const BASE_DELAY  = 50;                // ms
// On 412:
await sleep(BASE_DELAY * 2 ** attempt + Math.random() * BASE_DELAY);
```

This is jittered exponential backoff (50, ~110, ~250, ~550, ~1150, ~2350 ms). Without backoff the existing `while (retries <= MAX_RETRIES)` (`transactionService.ts:41-79`) ping-pongs through ETag conflicts in <100 ms under contention and exhausts retries before any natural staggering can resolve them. The cap of 6 attempts puts the worst-case wall time at ~5 seconds. `appendTransaction()` (single-input) gets the same backoff treatment — it's a strict win.

**Save-flow UX during retry.** A 5-second wall time looks like a frozen UI without explicit affordances. The Save handler in every form using `appendTransaction(s)`:

- Disables the Save button as soon as it's clicked.
- Replaces the button label with a spinner + "Saving..." (no per-attempt count — that's noisy).
- Threads an `AbortSignal` into `appendTransaction(s)`; the retry loop checks `signal.aborted` between sleeps AND after `getToken()` returns AND before issuing each `fetch`. Cancel-during-retry triggers `controller.abort()`, which propagates to in-flight `graphFetch`. **Caveat:** abort cannot interrupt MSAL's `acquireTokenSilent`/`acquireTokenPopup` (no public abort API for token acquisition); if the popup fallback is active when Cancel fires, the popup remains open until the user closes it manually. The next save attempt then resumes normally. Documented in test plan: assert `signal.aborted` is checked AFTER `getToken()` returns and BEFORE the actual `fetch`.
- On exhaustion, surfaces a "Try again" toast + re-enables the Save button (form state preserved, identity-frozen IDs preserved so the retry is idempotent).

**Sequential staged validation, incremental, Map-based.** Intra-batch dependencies must be enforced (e.g., a quick-add `item-create` must be visible to the subsequent `order-create`'s line-item check). Naive `deriveInventory(stagedLog)` per input is O(N²) on the full log; for a 50-line receive against a 5,000-tx log that's ~250k replay-steps × retries — browser-jank territory.

The fix has TWO parts. First, derive base state ONCE. Second, **operate on `Map<string, T>` not arrays**, so per-input updates are O(1). Today `deriveInventory()` builds an internal `Map<string, InventoryItem>` then returns `Array.from(items.values())` (`deriveState.ts:53,145`). We expose the map form:

```ts
// deriveState.ts (new exports)
export function deriveInventoryMap(txs: Transaction[]): Map<string, InventoryItem> { ... }
export function deriveOrdersMap   (txs: Transaction[]): Map<string, Order>         { ... }
// Existing deriveInventory / deriveOrders become thin wrappers: Array.from(map.values()).
```

`appendTransactions` keeps the working state as Maps, applies each input via a pure `applyTransaction(input, itemsMap, ordersMap)` that mutates a CLONE of the map (or returns a new one) in O(1) per input, and converts to arrays only when handing off to `validateTransaction` (which needs arrays for the existing item-validators) and to the final `WriteResult`.

```ts
// Given const log = await readTransactionLog(); — log.data is { transactions: unknown[], schemaVersion? }, log.known is Transaction[].
let itemsMap  = deriveInventoryMap(log.known);   // typed entries only
let ordersMap = deriveOrdersMap   (log.known);

for (const input of inputs) {
  parseTransactionInput(input);                                   // Zod parse — see below
  validateTransaction(input,
    Array.from(itemsMap.values()),
    Array.from(ordersMap.values()));                              // business rules
  ({ itemsMap, ordersMap } =
    applyTransaction(input, itemsMap, ordersMap));                // O(1) per input
}
```

The `Array.from(map.values())` call inside the loop is O(N) on items, so the overall complexity is still O(M·N) where M = batch size and N = items count — but the prior approach was O(M·N·T) where T = total transactions in the log. For M=50, N=5,000, T=10,000 that's a ~10,000× speedup.

A perf test exercises M=50, N=5,000, T=10,000 and asserts <100 ms total validation time. If the per-validator array allocation is itself the bottleneck, we'll switch the validator signature to accept maps too — flagged as a follow-up if the perf test fails.

**Input parsing — defense in depth.** `parseTransactionInput(input)` runs `TransactionWriteSchema.parse(...)` (the strict variant from step 0a-2; with synthetic `performedBy` / `timestamp` if not yet stamped) before business-rule validation. Today the existing `appendTransaction()` only validates business rules — Zod parsing happens at READ time (`fileOperations.ts:38`). A buggy `orderService` could write a TS-typed but Zod-invalid payload that then fails parse on the next read for everyone. Parsing on write closes that gap. Add to test list.

`validateTransaction()` (`src/api/transactionService.ts:87`) signature is extended to accept `(input, items, orders)`. The existing switch is case-exhaustive over the 5 old types and has no `default` arm — adding the three order types follows the same pattern. **Critically: order-type cases must NOT call `validateItemExists(input.itemId, items)`**, because for `order-*` events `input.itemId` is the ORDER's UUID, not an item's. A naive copy-paste of the existing item-cases would throw `ItemNotFoundError` on every order. Per-case rules:

| Case | Reads from `items` | Reads from `orders` | Validates |
|---|---|---|---|
| `order-create` | `lineItems[i].itemId` resolves against `items` (each line); stub items already staged in this same batch must be visible | none — `input.itemId` is a NEW order UUID, no existence check | header non-empty fields; PO# unused by non-cancelled orders; ≥1 line item; no duplicate `OrderLineItem.id` |
| `order-receive` | none directly (the batch's own `stock-in` rows handle item validation) | `orders.find(o => o.id === input.itemId && o.status === 'placed')`; receivedLines line-id-set === order.lineItems id-set | the cross-schema length/id-set check |
| `order-cancel` | none | `orders.find(o => o.id === input.itemId && o.status === 'placed')` | nothing else; `replacedBy` is informational (see schema note below) |

**Existing item/stock cases gain ONE new check:**

| Case | New rule |
|---|---|
| `item-delete` | Reject (`ItemReferencedByOrderError`) if any **placed** order has `lineItems[i].itemId === input.itemId`. The block is intentionally narrow: only `placed` orders represent active workflow that would break (the receive flow would throw `ItemNotFoundError` with no UI guidance). `received` orders are CLOSED — they're historical references, and their detail page renders a "Item deleted" placeholder for line items whose `itemId` no longer resolves. Allowing deletion of items referenced only by received orders keeps users from being permanently stuck (a 5-year-old received PO referencing the item should not block deletion forever). The cancel flow on a placed order is the user's escape hatch. |

`item-create`, `item-update`, `stock-in`, `stock-out` cases are otherwise unchanged.

**Idempotency rules** (precise) — **all ID lookups happen against the raw `data.transactions` array, NOT `known`**, so collisions with unknown stale-bundle entries are still detected:

- **Pre-input duplicate-id check.** If two inputs in the batch share an `id`, throw `DuplicateInputIdError` immediately (programmer error). Additional check for order events: if two `order-*` inputs share the same `itemId` (which is the order UUID for those types), throw `DuplicateOrderIdError` — catches the bug shape "`cancelAndRecreate` accidentally pointed both the cancel and the recreate at the predecessor's order id." (The `id` check above does NOT catch this because `tx.id` is unique per tx, but `itemId` would be reused.)
- **Full-match no-op.** If ALL input IDs already exist in `data.transactions` (raw) AND the corresponding entries in `known` (where they Zod-parsed successfully) match the inputs (same `type`, `itemId`, `data`), return the current derived state without writing — this is the idempotent retry path. An input ID that exists in raw but not in known (i.e., a `safeParse` failure on what should be one of OUR inputs) implies extreme schema drift or a programmer error and falls through to `IdReuseError` rather than spuriously matching.
- **Partial overlap.** If a STRICT SUBSET of input IDs exist in `data.transactions` (raw), throw `BatchPartiallyCommittedError`. Caller decides whether to surface as a conflict or retry with new IDs.
- **Mismatched id reuse.** If an input ID exists in `data.transactions` (raw) but the corresponding `known` entry has different `type`/`itemId`/`data` — OR the entry never made it into `known` (Zod-parse-failed) — throw `IdReuseError`.

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

**Layered shape — input vs payload.** `OrderCreateInput.attachments` and `OrderReceiveInput.attachments` are `File[]` (in-memory, pre-upload) at the service-input layer. `OrderCreateData.attachments` and `OrderReceiveData.attachments` are `OrderAttachment[]` (post-upload metadata) on the transaction payload. `createOrder` consumes `OrderCreateInput { attachments: File[] }`, runs the upload phase to produce `OrderAttachment[]`, then constructs `OrderCreateData { attachments: OrderAttachment[] }` for the transaction. Same shape for receive. Implementers MUST NOT wire `File[]` directly into the transaction payload.

**Autofill preference.** `findLatestLineItemForItem(itemId)` returns the most recent line across non-cancelled orders, ordered by `orderDate` descending, **regardless of status (`placed` or `received`)**. v1 picks the simple latest-by-date rule rather than preferring `received` over `placed`. Rationale: simpler, predictable; "latest tentative qty" is usually the intended autofill source for re-orders. Revisit if users hit friction.

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
   - On selecting an existing item: `findLatestLineItemForItem(itemId)` autofills `name`, `unitOfMeasure`, `unitCost`, `quantityOrdered`. **Searches only non-cancelled orders** (`status !== 'cancelled'`) — autofilling from a cancelled order's typo'd qty/cost would propagate the same mistake the user just cancelled. If no prior non-cancelled order exists for this item, fall back to the item's `unitCost` and `unitOfMeasure`. **UX hint:** if the function returns null AND the item has prior cancelled orders, show a small inline note next to the line: *"All prior orders for this item were cancelled — using item defaults."* So users debugging "why isn't autofill working" don't blame the picker.
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
2. Receive form (sub-route or modal) **pre-populates one row per `order.lineItems[i]`** (rows cannot be added or removed; the cross-schema check requires the receive's line-id-set match the order's exactly), each with: ordered qty, editable **received qty** (defaults to ordered, may be 0), **lot #** (required iff received qty > 0), **expiration date** (required iff received qty > 0). The form header has a **received-on date** picker that defaults to today; users may backdate up to 30 days (covers "we received this last Friday but the packing slip just landed on my desk"). Future dates are rejected. The chosen date persists on the transaction as `OrderReceiveData.actualReceiveDate`.
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
2. **Upload phase (on Save click).** Generate `orderId` upfront so paths are stable. Sequentially upload all staged files via `uploadOrderAttachment(orderId, file, stage, abortSignal)`, calling `ensureOrderFolder(orderId)` once before the first upload. **Each in-flight upload registers in `pendingUploads: Set<{ filename, abortController }>`**; the form's top-level `AbortController` (the same signal threaded into `appendTransactions` for commit-phase abort) **fans out to each child controller via `signal.addEventListener('abort', () => child.abort())`**, so a Cancel click during the upload phase aborts ALL in-flight uploads, not just the next-to-start. As each upload completes successfully, the entry moves from `pendingUploads` to `uploadedAttachments` in component state. On per-file upload failure: show inline error, leave already-uploaded files in the uploaded list, let the user retry/remove the failed file. The order transaction is NOT committed yet.

   **Signal plumbing.** `uploadOrderAttachment(orderId, file, stage, signal)` calls `graphFetch(url, { method: 'PUT', body: file, signal })`. `graphClient.ts:51-63` already accepts `RequestInit` (which includes `signal`), so no change is needed in `graphClient.ts` itself; the change is only that the new attachment service AND `transactionService.ts`'s `appendTransaction(s)` thread the signal through their `graphFetch` calls. `getToken()` cannot be aborted (MSAL has no public abort API), so the signal check happens AFTER `getToken()` returns and BEFORE the actual `fetch`, as documented under "Save-flow UX during retry."
3. **Commit phase.** Once all files are in `uploadedAttachments`, call `appendTransactions(...)` with the order transaction(s) that reference those filenames.
4. **Cleanup triggers** — any of these abandons the in-flight upload state and must DELETE the `uploadedAttachments` files (best-effort, fire-and-forget):
   - **User clicks Cancel** on the form.
   - **Commit fails** (`appendTransactions` throws after exhausting retries). The user is shown the error with two buttons: "Retry" (re-attempts commit using the same uploaded files) and "Discard" (cleanup + close form). On unmount-before-decision, default to Discard.
   - **Component unmount or navigation away** without an explicit Cancel/Retry decision — `useEffect` cleanup runs in two phases: (a) `abort()` every `pendingUploads` entry's controller (cancels in-flight PUTs that haven't yet committed server-side; with `keepalive: true` semantics on the PUT some may still complete, but the abort closes the local stream early), then (b) DELETE every `uploadedAttachments` entry. Files that complete server-side after abort are caught by the next admin prune run.
   - **Tab close / page refresh** — best-effort and explicitly NOT relied on. Implementation: a `beforeunload` AND `pagehide` listener (the latter for Safari/iOS) fires `fetch(graphDeleteUrl, { method: 'DELETE', headers: { Authorization: 'Bearer ' + cachedToken }, keepalive: true })` for each `uploadedAttachments` entry — but ONLY if a non-expired access token is already in MSAL's in-memory cache (checked via `acquireTokenSilent` with a synchronous-only fast path; if that would require iframe/popup/redirect, we skip). MSAL has no public sync API for "is there a token without I/O", so the implementation tries `acquireTokenSilent({ forceRefresh: false })` synchronously and treats any awaited promise resolution after the unload as a no-op. The `keepalive` flag has a 64 KB body cap which is not a concern for DELETE. **Tab close cleanup is documented as a courtesy, not a guarantee.**
   - **Logout** — register a cleanup handler on MSAL's `LOGOUT_START` event (NOT `LOGOUT_SUCCESS`, which fires after the cache is wiped). The handler synchronously fires DELETE for `uploadedAttachments` using the still-valid token; logout proceeds in parallel. If logout completes before all DELETEs return, the in-flight requests continue under their already-attached bearer header until network drains. Pure best-effort; if a DELETE 404s (because tab-close cleanup already ran, see "Logout → unmount race" below), it's swallowed. Admin pruning catches anything that escapes.

The canonical fallback for orphaned files is **admin pruning**. Bundled with this feature:

- **`scripts/prune-order-attachments.ts`** (new file) — a Node script intended to run from a maintainer's terminal, not in the browser. Reads `transactions.json` via Graph, derives the set of valid `orderId`s via `deriveOrders`, lists all subfolders under `/InventoryApp/orders/`, and DELETEs any folder whose `orderId` is not in the valid set. Prints a dry-run report by default; `--apply` actually deletes. Concurrent-safe: re-reads the log just before each DELETE and skips folders whose `orderId` became valid mid-run.

  **Auth model.** Browser MSAL doesn't apply in Node. The script uses **MSAL-Node device-code flow** with the same `clientId` and `tenantId` from `msalConfig` and the `loginScopes` already used by the SPA. On run, the script prints a code + URL, the maintainer opens the URL in a browser, signs in with their Microsoft 365 account, and Graph calls proceed under that user's permissions (the same `Sites.ReadWrite.All` scope the SPA uses). No client secret, no service principal, no admin consent needed beyond what's already configured for the SPA. README "Maintenance" section documents `npm run prune:dry` and `npm run prune:apply`.

  **TOCTOU safety — minimum-age filter.** A naive script could delete a folder belonging to an in-progress order: read log T0 (no order X) → user starts placing X (uploads files to `/orders/X/`) → script DELETEs folder → user's Save commits → Order X exists with attachment metadata pointing at vanished files. To mitigate, the script ONLY deletes folders whose `lastModifiedDateTime` (from Graph metadata) is older than 30 minutes. Active uploads are typically seconds-to-minutes; a 30-minute floor is well past any realistic save-flow window. The dry-run report explicitly lists "skipped N folders younger than 30 min (might be in-progress orders)" so maintainers see what's deferred. Re-reading the log just before each DELETE remains as a second line of defense.
5. **Receive flow:** same lifecycle, but uploads go into the existing order's folder; `ensureOrderFolder(orderId)` is still called (idempotent) in case the placement flow had no attachments.

**Cleanup is idempotent.** Logout-cleanup and unmount-cleanup race on the same `uploadedAttachments` set when a user logs out from a page with an in-flight order form: both fire DELETE for the same files. Graph DELETE on an already-deleted resource returns 404; the cleanup helper catches and swallows 404s explicitly so tests don't surface stack traces. Same applies to the tab-close path racing with admin pruning.

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
4. **Service return contract.** `appendTransaction()` and `appendTransactions()` are changed to return `WriteResult = { transactions: unknown[]; known: Transaction[]; items: InventoryItem[]; orders: Order[] }` instead of just `InventoryItem[]` — see "Service return type" above for why `transactions` is `unknown[]` and not `Transaction[]`. The context replaces all four from this return value. Existing call sites of `appendTransaction()` are updated (today there are none in production code paths — the function is exercised only by tests and the unwired `useInventoryData` hook, so the breaking change is contained).

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

**State shape — items/orders are stored, not memoized.** Naively, you might `useMemo(() => deriveInventory(transactions), [transactions])` in the provider. But after every successful `appendTransaction(s)`, the context replaces `transactions` with the new array (reference changes), `useMemo` invalidates, and `deriveInventory` runs over the FULL N-element log — defeating the whole point of `appendTransactions` returning the already-derived `WriteResult.items` / `.orders` from the Map-based incremental `applyTransaction`.

The context instead stores raw and derived state directly:

```ts
const [transactions, setTransactions] = useState<unknown[]>([]);     // raw array for write-back
const [known,        setKnown]        = useState<Transaction[]>([]);  // typed view for debugging/iteration
const [items,        setItems]        = useState<InventoryItem[]>([]);
const [orders,       setOrders]       = useState<Order[]>([]);

// Initial mount in MSAL mode: derive once.
useEffect(() => {
  if (!msalConfigured) return;
  initializeDataStore().then(() => readTransactionLog().then(({ data, known }) => {
    setTransactions(data.transactions);
    setKnown(known);
    setItems(deriveInventory(known));
    setOrders(deriveOrders(known));
  }));
}, []);

// commit() is PRIVATE to the context. Public methods (createOrder, receiveOrder,
// cancelOrder, addItem, updateItem, deleteItem, stockIn, stockOut) each construct
// their input array internally and call commit().
async function commit(inputs: TransactionInput[], signal?: AbortSignal): Promise<WriteResult> {
  try {
    const result = await appendTransactions(inputs, signal);
    setTransactions(result.transactions);  // RAW
    setKnown(result.known);
    setItems(result.items);
    setOrders(result.orders);
    return result;
  } catch (err) {
    // State unchanged on failure. Caller (form's submit handler) catches the error
    // to surface a "Try again" toast / re-enable the Save button. Errors propagate.
    throw err;
  }
}

// Example public method:
async function createOrder(input: OrderCreateInput, signal?: AbortSignal): Promise<Order> {
  const inputs = buildCreateOrderBatch(input);  // [...itemCreates, orderCreate]
  const result = await commit(inputs, signal);
  return result.orders.find(o => o.poNumber === input.poNumber)!;
}
```

`commit` is internal — the public surface remains the named methods listed under "Context surface gains" above. Each public method constructs its inputs (including pre-rolled UUIDs/SKUs per the frozen-identity rule) and calls `commit`. Initial mount pays the O(N) replay once; subsequent commits are O(1) at the context layer (`applyTransaction`'s incremental work is already done inside `appendTransactions`).

### `/orders` — list
Table: PO#, supplier, order date, expected delivery, status badge, line count, total $. Filters: status, supplier, date range. Search: PO# or confirmation#. "+ New Order" top-right.

### `/orders/new` — create
Header (PO#, conf#, supplier autocomplete, expected delivery), Order docs upload, line items rows, live total, Save / Cancel.

### `/orders/:id` — detail
Read-only PO header + status badge. **Line item table renders the order's snapshot fields directly (`name`, `unitOfMeasure`, `quantityOrdered`, `quantityReceived`, `lotNumber`, `expirationDate`); never cross-references current `item.batches` or current `InventoryItem.unitOfMeasure`.** This locks in the historical-record contract: an order's line shows what was ordered/received then, not what the item looks like now. If `lineItems[i].itemId` no longer resolves (the item was deleted — possible per the narrowed `item-delete` rule above for received orders), render a "Item deleted" placeholder with the snapshotted name still visible. Attachments split: "Order docs" + "Receive docs" with download links. Action buttons by status: `placed` → Receive / Cancel / **"Edit (cancels original on save)"** (the button label is explicit about the consequence to avoid the abandonment trap — opens the recreate form with a banner reiterating that closing the tab without saving leaves the original active); `received` and `cancelled` → no actions. Activity timeline of related transactions.

### `/orders/:id/receive` — receive
Editable received qty / lot / expiration per line; editable `actualReceiveDate` (defaults today, backdate up to 30 days); receive docs upload; Confirm. **Pre-populates one row per `order.lineItems[i]`** with `quantityReceived` defaulting to `quantityOrdered`; users may zero rows but cannot add or remove them — the cross-schema check (`receivedLines` line-id-set === `order.lineItems` line-id-set) requires an exact 1:1 mapping. **Status-change redirect:**

```ts
useEffect(() => {
  if (order && order.status !== 'placed') {
    navigate(`/orders/${id}`, { replace: true });
  }
}, [order?.status, id, navigate]);
```

The dependency on `order?.status` (not empty `[]`) is intentional: it covers BOTH the bookmark/stale-link case (status was already not-placed at mount) AND the "user's own commit succeeds, status flips to received, re-render fires the redirect" case. There's no real-time push in this app, so a third-party-flipped-status mid-edit is currently impossible — but the rule is robust if that's added later.

### Dashboard additions
- **Open Orders** card — count of `placed` POs, links to filtered list.
- **Overdue Orders** callout — `placed` POs whose `expectedDeliveryDate` < today. **Mock data note:** if the orders feature is exposed in dev mode, `src/mock/data.ts` mock orders compute `expectedDeliveryDate` as `today + N days` at module load (using a small helper `daysFromToday(n)`), NOT hardcoded ISO strings. Hardcoded mock dates will become "overdue" the day after a commit and pollute the dashboard for every dev who pulls. **`daysFromToday(n)` returns `YYYY-MM-DD`** (date only, no time component) — full ISO timestamps make the function timezone-flaky (a value computed at 23:59 UTC-7 differs from one computed at 00:01 the next morning).

### Activity feed updates (`src/pages/Dashboard.tsx`)
The current activity feed at `src/pages/Dashboard.tsx:101` only renders item/stock transaction types and falls through to a no-render default for unknown types. Order events would otherwise appear blank. Three updates:

1. **Move `tx.data` casts inside each `case`.** Today `renderText()` reads `(tx.data as StockData).quantity` and `(tx.data as StockData).note` UNCONDITIONALLY at `src/pages/Dashboard.tsx:120-121`, BEFORE the switch. This works by accident for current types because `quantity` happens to be a property of `ItemCreateData` too, but adding `order-*` types newly exposes the bug: `OrderCreateData.quantity` doesn't exist (only `lineItems[i].quantityOrdered`), and the `note` cast on `OrderCreateData` would read undefined or worse if a future schema change shifts the field. The fix is independent of the order rollout but MUST be done in the same step: each `case` extracts the data it needs (`const d = tx.data as StockData;` inside the case), the unconditional reads at lines 120-121 are removed.
2. Extend `typeConfig` (`src/pages/Dashboard.tsx:105`) with entries for `order-create`, `order-receive`, `order-cancel` (icons + class).
3. Extend `renderText()` (`src/pages/Dashboard.tsx:118`): for order-* events, look up the order via `orders.find(o => o.id === tx.itemId)` instead of `items.find` (since `tx.itemId` is the order's UUID for these types). Render messages like *"Placed PO-2026-0101 to Qiagen — 3 lines"*, *"Received PO-2026-0101 — 3 batches added"*, *"Cancelled PO-2026-0101"*.

`stock-in` rows emitted from a receive event continue to render normally; if `tx.data.orderId` is present, look up via `orders.find(o => o.id === tx.data.orderId)` and append `"(via PO-{poNumber})"` if active, `"(via cancelled PO-{poNumber})"` if the linked order's status is `cancelled`. The lookup is by order UUID (stable), not PO#, so even if PO# is later reused by another order the suffix still resolves to the correct historical order.

## Permissions & threat model

Matches existing inventory model:
- All authenticated users: create, edit, receive, cancel orders; upload/delete attachments on placed orders.
- Admin only (client-side enforcement, same as existing CSV import): delete attachments from `received` or `cancelled` orders. Enforced via the same `isAdmin()` gate used for import.

**Threat model — explicit acknowledgement.** Permissions above are **UX gates, not security boundaries**. Any authenticated user holds a Graph token with `Sites.ReadWrite.All` scoped to the configured SharePoint site (per `src/auth/msalConfig.ts`'s `loginScopes`). They could bypass the UI and directly DELETE any file under `/InventoryApp/orders/...`, or PUT a doctored `transactions.json` with someone else's `performedBy` email. The intended user population is a 5-person biolab team, all with similar trust level — matching the threat model the existing `transactions.json` design already accepts. If a future deployment needs hardened multi-tenant isolation, that requires per-folder SharePoint permission splits and a backend signing layer; both are explicitly out of scope (listed in YAGNI).

**Audit gap on admin attachment removal.** When an admin deletes an attachment from a `received` or `cancelled` order, the SharePoint file is gone but no transaction is emitted (there's no `attachment-delete` transaction type). The `Order.attachments` array (derived from the `order-create` / `order-receive` payload) still references the now-missing filename. The detail page handles this gracefully (download link 404s → "File no longer available" placeholder), but the deletion itself is unaudited beyond SharePoint's own version history. Acceptable for the current threat model (admin actions are rare and tracked in SharePoint), but flagged as a known gap. Adding `attachment-delete` would be the v2 fix.

## Validation (Zod + business rules)

- `poNumber`: `z.string().trim().regex(/^[A-Za-z0-9-]{1,32}$/, 'PO# must be 1-32 ASCII alphanumerics or dashes')`, **unique across non-cancelled orders** (checked at save against `deriveOrders(transactions)`). The regex blocks emoji, RTL marks, mixed-script confusables (Cyrillic `О` vs Latin `O`), and stray whitespace that would let two visually-identical POs both pass uniqueness. PO numbers from cancelled orders are released and may be reused — this enables the v1 "edit = cancel + recreate" workflow without forcing the user to mint a new number. Suppliers' free-form PO strings must be normalized at entry (UI shows live regex-fail feedback).
- `orderConfirmationNumber`: required, non-empty.
- `supplier`: required.
- At least one line item required.
- Per line: `quantityOrdered > 0`, `unitCost >= 0`, `name` non-empty, `unitOfMeasure` non-empty.
- Receive per line: `quantityReceived >= 0` integer; `lotNumber` non-empty AND `expirationDate` parseable IFF `quantityReceived > 0`. **Past expiration:** if `expirationDate < today`, the receive form shows an inline warning *"Lot expires before today — record reason"* and reveals an optional `pastExpirationReason` text field. The reason (if entered) is stored on the `OrderReceiveData.receivedLines[i].pastExpirationReason` field for compliance audit. Submitting with an empty reason is allowed but logged as `"(none provided)"`. Schema: `pastExpirationReason: z.string().optional()` on the per-line shape.
- Receive header: `actualReceiveDate` defaults to today; user-editable; backdating up to 30 days allowed; future dates rejected.
  - **Schema-level (replay-stable):** `z.string().regex(/^\d{4}-\d{2}-\d{2}$/)` only. NO `.refine(isWithin30DaysPastOrToday)` at the schema layer — a transaction valid when written in May would become invalid 31 days later when re-read in June, dropping the `order-receive` event from `known` on every replay and silently reverting the order to status `placed`. Schema validation must be replay-stable.
  - **UI/business-rule layer (form-submit only):** the receive form's submit handler enforces "today − 30 days ≤ actualReceiveDate ≤ today" against the user's local clock before constructing the transaction input. `validateTransaction('order-receive')` may also enforce this against `Date.now()` for newly-staged inputs (it never runs against historical events during replay), but the canonical check lives in the form.
- Attachments: extension AND MIME both in allowed set; `sizeBytes <= 25 MB`. Reject before upload begins.
- New `order-*` transactions enforced by Zod discriminated union; existing `validateTransaction()` switch in `transactionService.ts:87` extended with `order-create` (validates header + line items + ensures all `lineItems[].itemId` resolve), `order-receive` (validates target order is `placed`; received lines map to existing line ids), `order-cancel` (validates target order is `placed`).

## Edge cases

- **Short-receive** (received < ordered, > 0): allowed, recorded as-is. Order moves to `received`. Detail shows `"7 of 10 received"`.
- **Zero-receive** (received === 0): allowed; line emits NO `stock-in`; `lotNumber`/`expirationDate` not required for that line.
- **Over-receive** (received > ordered): allowed with confirmation prompt. Recorded as-is.
- **Editing a placed order:** v1 has NO direct edit. The detail page exposes a "Cancel & Re-create" button on `placed` POs that pre-fills `/orders/new` with the current PO's data (including the PO# — reusable since the predecessor will be cancelled) and emits the cancel + recreate as a single `appendTransactions` batch when saved. The cancel transaction's `note` is auto-filled with `"Replaced by PO-<new-po-number>"` and `replacedBy` carries the new order's UUID. The recreate form shows a banner: *"Editing PO-2026-0101 — saving will cancel the original and create a replacement. Closing this tab without saving leaves the original active."* (Avoids adding an `order-update` event type for v1; revisit if users hit friction.)
- **Cancel & Re-create — batch ordering (LOAD-BEARING).** The batch is `[itemCreates..., orderCancel(predecessor), orderCreate(replacement)]` — **cancel MUST precede create**. Reason: staged validation processes inputs in order, and the recreate's PO#-uniqueness check passes only if the predecessor has already been moved to `cancelled` by the prior cancel event in the staged log. Reversing the order makes the recreate fail "PO# in use." Test enforces this ordering; the `orderService.cancelAndRecreate(...)` helper hard-codes it.
- **Cancel & Re-create — `itemId` invariant.** `orderCancel.itemId = predecessor.id`; `orderCreate.itemId = replacement.id` (a NEW UUID). They MUST differ. The trap shape "both point at the predecessor's id with `replacedBy` pointing at the replacement" is exactly what `DuplicateOrderIdError` catches in the pre-input duplicate-id check, but a future implementer reading only the cancel-and-recreate flow might write that bug. Code comment in `cancelAndRecreate(...)` makes this explicit.
- **Cancel & Re-create — receive vs cancel race.** User A clicks Receive on PO-100; user B clicks Cancel on PO-100 simultaneously. Both reads see `status: 'placed'`. Whoever's `appendTransactions` writes first wins. The loser's commit gets a 412, retries, re-reads, sees the new status, and the staged validator rejects with a clear message: *"PO-100 has already been received by someone else"* (or cancelled, depending on which won). Same shape as the PO#-uniqueness race below.
- **Cancel & Re-create — concurrent PO# race:** if another user places PO-100 in the gap between the user clicking "Cancel & Re-create" on their own PO-100 and clicking Save, the recreate's batch fails the staged-validation PO# uniqueness check (since the new PO-100 is now active and uncancelled). Surfaced to the user as: *"PO-100 was just claimed by someone else. Pick a new number or cancel this edit."* Test case in `appendTransactions.test.ts`.
- **Stub items in the inventory list:** quick-add stubs default to `quantity: 0`, `location: 'Unspecified'`, `category: 'Uncategorized'`, and a new `isStub: boolean` flag set by the `item-create` payload. Add `isStub` to `InventoryItem`, `ItemCreateData`, and `ItemUpdateData`. **Schemas:**
  - `ItemCreateDataSchema.isStub: z.boolean().default(false)` — quick-add explicitly sets `true`; CSV import (`Import.tsx`) and the existing `NewItem` page omit it, defaulting to `false`. Replaying an old `item-create` (no `isStub` field) defaults to `false` correctly.
  - `ItemUpdateDataSchema.isStub: z.literal(false).optional()` — only forward graduation via update; users cannot manually re-stub.

  `/inventory` and the dashboard's low-stock alert filter out `isStub === true` by default; the list page gets a "Show stubs (N)" toggle. **Stub graduation is monotonic in `deriveInventory`:** the first replay step that produces `quantity > 0` for a stub flips `isStub` to `false`; once flipped, subsequent replay steps NEVER flip it back to `true` (even if a hypothetical future stock-out drains qty back to zero). Likewise, an `item-update` with `isStub: false` flips it once and is monotonic. Test asserts the monotonicity invariant on a fixture with stub-create → stock-in → stock-out-to-zero (final state: `isStub: false`).
- **Stub items from a cancelled order:** stay in inventory with qty 0. Visible only via the "Show stubs" toggle. User deletes manually. Not auto-cleaned.
- **Concurrent edits / conflict:** existing `appendTransaction` retry loop handles 412 by re-deriving and re-validating. `appendTransactions` does the same. PO# uniqueness is re-checked after retry, so a concurrent PO# can be detected.
- **Attachment upload failure mid-save:** see "Attachment lifecycle" — staged files retried independently; order commit happens only after upload phase resolves.
- **Cancelled order with attachments:** files stay on SharePoint and remain accessible from the detail page.
- **Empty order folder when all attachments are removed before commit:** if a user adds attachments, uploads them, then removes them all (each cleanup deletes the file), the per-order folder created by `ensureOrderFolder()` may be left empty. The pruning script (`scripts/prune-order-attachments.ts`) handles this — empty folders for unknown order IDs are removed in the same pass. Not blocking; folders are cheap.
- **Refresh mid-save creates duplicate stub items.** If the user submits an order with quick-add stubs and the network drops between server-processing and client-receiving the 200, the user might refresh the page before the retry-with-frozen-identity completes. On the next save attempt, fresh UUIDs/SKUs are minted (frozen-identity is per-batch, not per-logical-flow). PO# uniqueness blocks the duplicate ORDER, but the stub `item-create` events from the first attempt are already in the log AND the second attempt also writes its own stubs. Net result: 2× stubs for the same intended item. Cleanup is via the "Show stubs" toggle + manual delete. **Acceptable in v1**; documented here so users debugging "why are there two of this stub" know the cause. A v2 fix would require a session-stable identity token persisted in localStorage that survives refresh.
- **Refresh mid-receive lands on a now-`received` PO.** Same shape as above: receive completes server-side, the user refreshes thinking it failed, the page reloads showing status `received` with `actualReceiveDate` just set. The receive form's `/orders/:id/receive` route detects status≠`placed` on mount and redirects to the detail page with a toast: *"This PO was received successfully — refreshing showed the latest state."* If the recently-received PO has `createdBy === currentUser` and `actualReceiveDate` within the last 5 minutes, the toast says *"You received this PO a moment ago — the previous attempt succeeded."* No data is lost; UX explains itself.
- **`actualReceiveDate` typo is permanent.** Once an order is `received`, no edit path exists (received → no actions per detail-page rules). A typo in the receive-on date (e.g., 5/1 instead of 5/3) requires admin intervention (manual log edit through SharePoint) or a future v2 `order-amend` event type. Accepted v1 limit; documented for users debugging "how do I fix the receive date."

## Testing (Vitest, follows existing patterns under `src/**/__tests__/`)

- Schema validation: `OrderCreateData`, `OrderReceiveData`, `OrderCancelData` accept valid shapes, reject invalid (e.g., `quantityOrdered <= 0`, missing lot when `quantityReceived > 0`, empty `receivedLines`, mismatched line ids between receive and target order). **`OrderCancelData.replacedBy`:** Zod validates only as `uuid().optional()`; assert that the validator does NOT reject a `replacedBy` referencing an order id absent from the persisted log (informational-only contract).
- **`validateTransaction` case-table tests:** explicit assertions for each order type — `order-create` does NOT call `validateItemExists(input.itemId, items)` (would throw); `order-receive` rejects with target order in `received` or `cancelled` state; `order-cancel` rejects with target in `cancelled` state.
- `deriveOrders.test.ts`: replay sequences produce expected order state for create / receive / cancel. Out-of-order or duplicate events are tolerated (idempotency). Defensive ignore: `item-*` referencing an order's UUID is logged and skipped; `order-*` referencing an unknown id same.
- `deriveState.test.ts` invariant test: order ID set ∩ item ID set = ∅ on a representative log; intentional collision fixture verifies defensive-ignore path.
- `appendTransactions.test.ts`: atomic batch write; 412-retry with backoff (mock the sleep); sequential staged validation (intra-batch dependencies enforced); incremental `applyTransaction` matches `deriveInventory(stagedLog)` on a 100-event fixture; perf test asserts <100ms validation on 50-line receive against a 10k-tx log generated at test setup via a deterministic seeded helper `generatePerfFixture(N: number, seed: number = 42)` using a small mulberry32/xorshift PRNG (NOT committed as a JSON fixture — keeps repo lean); idempotency cases — full-match no-op, partial-overlap throws `BatchPartiallyCommittedError`, intra-batch duplicate id throws `DuplicateInputIdError`, dup-itemId-on-order-events throws `DuplicateOrderIdError`, mismatched-id-reuse throws `IdReuseError`; **identity-frozen test** — simulate 412 conflict, assert all `id` and `sku` values in retry attempt match the first attempt; **Zod parse on write** — TS-typed but Zod-invalid input is rejected before write (e.g. malformed UUID, extra unknown key); **write-path strictness regression guard** — `validateItemUpdate({ quantity: 999 })` STILL throws (`.strict()` preserved on write-path schema despite read-path tolerance); **Cancel & Re-create race** — a concurrent placement of the same PO# between read and write fails the recreate's batch and surfaces a clear error; **AbortSignal** — cancel-during-retry aborts in-flight `graphFetch` (not in-flight token acquisition) and triggers attachment cleanup; **upload-session fallback** — `writeTransactionLog` with body >4MB switches to upload session, returns the new eTag; **single-input shares batch path** — `appendTransaction(input)` is asserted to call `appendTransactions([input])` (mock `applyTransaction`, verify single invocation with the wrapped array) so retry/idempotency/raw-round-trip behaviors don't drift between the two surfaces.
- **Stale-tab compat:** fixture writes a v2 log with order events; old-bundle reader reads it via `TransactionReadSchema` (`.passthrough()`-based), derives inventory minus orders correctly; old-bundle reader does a stock-in via `appendTransaction`; assert the round-tripped JSON contains all original `order-*` entries byte-identical (write-back preserves unknown entries from `data.transactions` raw array).
- `orderService.test.ts`: create (with and without quick-add items), receive (full / short / zero / over per line), cancel. Verify `stock-in` emissions match non-zero received lines and that batches land on correct items via `deriveInventory`. **Cancel & Re-create batch ordering:** `orderService.cancelAndRecreate(...)` always emits `[itemCreates..., orderCancel(predecessor), orderCreate(replacement)]` in that order; reversing order would fail PO#-uniqueness; helper hard-codes the order. `replacedBy` and `note: "Replaced by PO-..."` populated on the cancel transaction.
- **Cancel & Re-create vs Receive race:** fixture where two batches target the same order; assert the loser surfaces a clear status-mismatch error after retry.
- **Stub graduation monotonicity:** fixture `item-create(stub) → stock-in → stock-out-to-zero` produces final state `isStub: false`; fixture `item-create(stub) → item-update(isStub:false) → no further updates` stays `isStub: false`.
- `findLatestLineItemForItem.test.ts`: returns the most recent line from a non-cancelled order; returns null if all matching orders are cancelled; returns null with no prior orders.
- `validation.test.ts`: receive validation (lot/exp required gating on received qty); empty `receivedLines` rejected; past expiration warning + optional reason field.
- `unitOfMeasure` migration: replaying old `item-create` transactions defaults to `'each'`; replaying old `item-update` transactions does NOT inject `unitOfMeasure` (preserves the previously-set value); new transactions persist user-selected value; CSV import treats column as optional. **`ItemDetail` form test:** submit with `unitOfMeasure: ''` — handler converts to `undefined` before submit, schema accepts.
- `Dashboard.test.tsx`: order events render correct text; cast-inside-case refactor — replaying a fixture with mixed transaction types does not throw on the unconditional-read removed at line 120-121; `isStub` items excluded from low-stock alert (the toggle lives on `/inventory`, not the dashboard).
- Attachment validation: rejects oversized, disallowed ext, mismatched MIME; de-duplicates on `name + size`.
- Attachment cleanup: on commit-failure path, uploaded files are DELETEd (best-effort); on user Cancel, uploaded files are DELETEd; on form unmount without explicit decision, cleanup fires; **logout fires DELETE on `LOGOUT_START`** (NOT `LOGOUT_SUCCESS`) so token is still valid; tab-close best-effort attempt is documented and tested with a mocked `pagehide`/`beforeunload` listener (assertion: cleanup is queued, not awaited). **Idempotent cleanup:** when logout-cleanup and unmount-cleanup race on the same files, second-runner's DELETE returns 404; helper swallows 404 and test asserts no error surface.
- Bootstrap: `/orders/` folder creation tolerates 409/412; `ensureOrderFolder` is idempotent across repeated calls in one flow.
- `InventoryContext` bootstrap: in mock mode (no MSAL config), context loads mocks; in SharePoint mode, context derives state from `transactions.json` and `mockItems`/`mockTransactions` are NOT read; `useInventoryData` is removed (build fails if any caller is added later).
- `scripts/prune-order-attachments.ts`: dry-run lists folders that would be deleted; `--apply` only deletes folders whose `orderId` is absent from `deriveOrders(log)`; tolerates concurrent writes (re-reads and skips folders that became valid mid-run). **Auth path:** mock MSAL-Node device-code flow in tests; the live device-code path is exercised manually by maintainers (out of automated CI).
- **Forward-compat schema rollback:** new bundle writes a log with `order-*` entries + `schemaVersion: 2`; old bundle's `TransactionLogSchema.parse()` (with the v2 tolerance change in step 0a or earlier) reads the log without throwing; unknown transaction types are dropped from in-memory log with a console warning; v1 reader-on-v2 file shows inventory minus orders.
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

0. **Unify MSAL** (pre-req). Refactor so a single `PublicClientApplication` is initialized once (in the new `src/auth/msalInstance.ts` module) and reused by both `AuthGate.tsx` and `transactionService.ts`. Delete `AuthProvider.tsx`. **Update test mocks** — `src/api/__tests__/transactionService.test.ts:4`, `src/api/__tests__/bootstrap.test.ts:4`, and `src/api/__tests__/fileOperations.test.ts:4` all currently `vi.mock('../../auth/AuthProvider', ...)`; replace with `vi.mock('../../auth/msalInstance', ...)`. Without this update, `npm test` fails at module-resolution time the moment `AuthProvider.tsx` is deleted. Smoke test: `appendTransaction` works end-to-end against SharePoint when MSAL is configured.

0a. **SharePoint-mode `InventoryContext` bootstrap + WriteResult contract change** (pre-req). Bundled because each part creates production dependencies on the others:
   - Change `appendTransaction()` return shape from `Promise<InventoryItem[]>` to `Promise<WriteResult>` where `WriteResult = { transactions: unknown[]; known: Transaction[]; items: InventoryItem[]; orders: Order[] }` — the canonical 4-field shape. The `orders` field is `[]` from a stub `deriveOrders()` placeholder until step 3 lands the real implementation. The `known` field arrives wired to the new `readTransactionLog()` return shape that step 0a-2 introduces; until 0a-2 lands `known` simply mirrors `transactions` cast to `Transaction[]` (no unknown entries exist yet because no stale-bundle scenario has occurred). Tests assert against the full 4-field shape from this step onward — no follow-up rewrite needed when 0a-2 lands.
   - **Update existing test assertions:** `src/api/__tests__/transactionService.test.ts:36-61` ("appendTransaction (design contract)") asserts against the OLD `Promise<InventoryItem[]>` return shape — rewrite to assert the new `WriteResult`. Same file's "TransactionInput shape" tests at line 25 reference comments tied to the old contract; update phrasing.
   - On provider mount in MSAL-configured mode, run `initializeDataStore()` + `readTransactionLog()` and derive `items`/`orders` from the log instead of using mocks.
   - Migrate the existing item/stock mutator methods to delegate to `appendTransaction()` in SharePoint mode (turning callers async — the touched pages are NewItem, ItemDetail, StockForm, Import). Callers consume the new `WriteResult` shape directly.
   - **Delete `src/hooks/useInventoryData.ts`** (no callers, dead code).
   - Add the production-caller assertion (`scripts/check-no-old-write-result.ts` or a CI grep) — pinned to the NEW shape, so any future regression is caught immediately.
   - Mock-mode behavior unchanged.

   The order within this step is: change return shape → update existing tests → migrate callers → delete hook → add CI gate. Without bundling, the CI gate would self-fail mid-step OR existing tests would fail at module-resolution. PR is medium-sized.

0a-2. **Forward-compat schema tolerance** (pre-req). Two changes that travel together:

   a. **Top-level log:** change `TransactionLogSchema` to use `z.array(z.unknown())` at the top level and per-element `safeParse` against `TransactionReadSchema`. Add `schemaVersion: z.literal(2).optional()` to `TransactionLog` (writers always set it; readers ignore unknown values).

   **Stale-tab write-back rule (LOAD-BEARING):** `readTransactionLog()` returns TWO arrays in its result, not one:
   ```ts
   interface FileReadResult {
     data: { transactions: unknown[]; schemaVersion?: 2 };  // raw, includes unknown entries verbatim
     known: Transaction[];                                   // safeParse-passing entries only, for derivers
     eTag: string;
   }
   ```
   Derivers (`deriveInventory`, `deriveOrders`, validators) operate on `known` — so a stale tab simply doesn't see order events.

   `writeTransactionLog()` writes `data.transactions` (the RAW array) with the new transaction(s) appended:
   ```ts
   const newRaw = [...result.data.transactions, ...newTxs];
   await writeTransactionLog({ schemaVersion: 2, transactions: newRaw }, result.eTag);
   ```
   This preserves unknown entries byte-for-byte across the round-trip. A stale tab that does a stock-in does NOT erase order events written by newer code. Test fixture: stale-schema reader reads a log with order events, performs a stock-in, writes back; assert the round-tripped JSON contains all original `order-*` entries unchanged.

   b. **Per-payload tolerance — read-path only.** The naive fix is to drop `.strict()` everywhere, but that ELIMINATES a real safety check: `ItemUpdateDataSchema.strict()` is the whitelist that prevents a buggy `updateItem` call from injecting `quantity: 999` (the comment at `validation.ts:51` calls this out explicitly), and `deriveInventory` would then merge that bad field at `deriveState.ts:96`. Dropping `.strict()` breaks the documented intent.

   The right fix is to keep `.strict()` for the WRITE path and switch to `.passthrough()` for the READ path:

   ```ts
   // schemas.ts — strict variants used on write
   export const ItemCreateDataSchema = z.object({...}).strict();
   export const ItemUpdateDataSchema = z.object({...}).strict();
   // ... etc

   // tolerant variants used by per-element safeParse on read
   export const ItemCreateDataSchemaTolerant = ItemCreateDataSchema.passthrough();
   export const ItemUpdateDataSchemaTolerant = ItemUpdateDataSchema.passthrough();
   // ... etc

   // The read-path discriminated union uses the *Tolerant variants:
   export const TransactionReadSchema  = z.discriminatedUnion('type', [...tolerant members]);
   // The write-path union (used by parseTransactionInput()) uses the strict variants:
   export const TransactionWriteSchema = z.discriminatedUnion('type', [...strict members]);
   ```

   `validateItemUpdate()` (`validation.ts:50-53`) keeps using `ItemUpdateDataSchema.parse(data)` (strict) — the safety check is preserved. `parseTransactionInput()` uses `TransactionWriteSchema`. The per-element `safeParse` in the log read uses `TransactionReadSchema`. A stale tab reading a v2 log uses ITS old `TransactionReadSchema` definition (already non-strict via `.passthrough()`), so unknown fields like `unitOfMeasure` pass through without dropping the transaction.

   Both (a) and (b) must land before step 1 commits any new field; otherwise the rollout itself breaks stale tabs. Tests: (i) write-path strictness still rejects a payload with `quantity` in it (regression guard); (ii) read-path tolerance accepts a payload with unknown extra fields and exposes them on the parsed object.

0b. **Retry/backoff + Zod-on-write hardening** (pre-req). Add jittered exponential backoff to `appendTransaction`'s retry loop (`MAX_RETRIES` 3 → 6, base delay 50ms × 2^attempt + random jitter). **Note:** existing item/stock mutations (now async per step 0a) will see worst-case wall time grow from ~150ms to ~5s in the rare contention case; surface as a "Try again" toast rather than a thrown error. Add `parseTransactionInput()` that runs `TransactionWriteSchema.parse(...)` (the strict variant from step 0a-2) before business validation. Tests for both. Lands before `appendTransactions` because it shares the loop body. **Also lands the `writeTransactionLog` upload-session fallback** for bodies > 4MB documented in the API additions section.

0c. **`Dashboard.tsx` activity feed safety refactor** (pre-req for step 5). Move the `tx.data` casts inside each `case` of `renderText()` (lines 120-121); remove the unconditional `(tx.data as StockData).quantity` and `.note` reads. No behavior change for existing transaction types; unblocks safe addition of order types in step 5.
1. `unitOfMeasure` field rolled out across model, schemas (create has `.default('each')`, update has `.optional()` with NO default), derive, mock, NewItem/ItemDetail/InventoryList (with empty-string→undefined submit shim), CSV import/export. Tests + docs. *(Touches the most files; standalone.)*
1a. `isStub` field rolled out: add to `InventoryItem`, `ItemCreateData`, `ItemUpdateData`, schemas (update is `z.literal(false).optional()`), `deriveInventory` graduation logic, `InventoryList` "Show stubs" toggle, dashboard low-stock filter excludes stubs. Tests.
2. Transaction model: add `order-create` / `order-receive` / `order-cancel` types + Zod schemas (with `OrderReceiveDataSchema` per-line refinements; cross-schema `receivedLines.length === order.lineItems.length` check in `validateTransaction`). Extend `validateTransaction()` signature to `(input, items, orders)` and add cases for the new types. `appendTransactions()` helper with sequential incremental staged validation (`applyTransaction` helper extracted), frozen-identity rule, idempotency rules + tests (including the perf test on 10k-tx fixture).
3. `deriveOrders()` + `Order` types + `orderService` (create / cancel only at this stage) + `findLatestLineItemForItem` (filters non-cancelled) + tests. Defensive-ignore branches in derivers.
4. `/orders` list, `/orders/new`, `/orders/:id` (without attachments, without receive). End-to-end flow for placed POs. Activity feed renders `order-create` / `order-cancel`. Mock orders use relative dates (`daysFromToday(n)`) if exposed in dev mode.
5. Receive flow: `receiveOrder` in service, `/orders/:id/receive` form, dashboard "Open Orders" + "Overdue Orders" cards. Activity feed gains `order-receive` rendering and `(via PO-...)` traceability suffix on stock-in rows. Past-expiration warning + optional reason field.
6. Attachments: `bootstrap.ts` adds `orders/` folder. `attachmentService.ts` (`ensureOrderFolder`, upload, delete, getUrl). Staged upload lifecycle in create + receive forms with name+size dedup, beforeunload+pagehide cleanup, logout cleanup. Detail page renders both buckets with download links. **`scripts/prune-order-attachments.ts`** ships in this step with README "Maintenance" docs.
7. Polish: "Edit (cancels original on save)" button + banner on detail page; supplier autocomplete; PO# uniqueness UX (concurrent-PO# race surfaces clear error); empty-receive guard messaging.
