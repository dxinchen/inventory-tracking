# Orders Feature Design

**Date:** 2026-05-09
**Status:** Design approved, ready for implementation plan

## Overview

Add a Purchase Order (PO) feature to the inventory tracker. Most orders repeat the same items, so the form is optimized for fast re-ordering: search existing inventory, autofill from the most recent line item, edit what's different, save. Items that don't yet exist can be quick-added with minimum fields.

Orders follow a two-step lifecycle: **placed → received**. Receiving a PO emits one `stock-in` transaction per line, so the existing batch / FEFO machinery keeps working unchanged.

## Data model

### `Order` (PO header)

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | |
| `poNumber` | string | manual entry, unique across all orders |
| `orderConfirmationNumber` | string | required |
| `supplier` | string | one supplier per PO; autocomplete from existing suppliers |
| `orderDate` | ISO date | auto-set to today on create |
| `expectedDeliveryDate` | ISO date \| null | optional |
| `actualReceiveDate` | ISO date \| null | set on receive |
| `status` | `'placed' \| 'received' \| 'cancelled'` | |
| `lineItems` | `OrderLineItem[]` | at least 1 required |
| `attachments` | `OrderAttachment[]` | optional; each tagged with `stage` |
| `createdBy` | email | |
| `updatedAt` | ISO timestamp | |
| `note` | string \| null | optional |

### `OrderLineItem` (embedded in `Order.lineItems`)

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | |
| `itemId` | string | links to `InventoryItem.id` |
| `name` | string | snapshot at order time |
| `unitOfMeasure` | string | `'each' \| 'box' \| 'kit' \| 'case'` or custom |
| `quantityOrdered` | number | `> 0` |
| `quantityReceived` | number \| null | set on receive; may differ for short / over-receive |
| `unitCost` | number | `>= 0` |
| `lotNumber` | string \| null | set on receive |
| `expirationDate` | ISO date \| null | set on receive |

### `OrderAttachment` (embedded in `Order.attachments`)

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | |
| `stage` | `'placed' \| 'received'` | which bucket this file belongs to |
| `filename` | string | sanitized name as stored on SharePoint |
| `originalFilename` | string | as uploaded by the user |
| `contentType` | string | MIME |
| `sizeBytes` | number | |
| `uploadedAt` | ISO timestamp | |
| `uploadedBy` | email | |

Allowed file types: PDF, images (jpg/jpeg/png/heic), Office docs (docx/xlsx). Per-file limit: 25 MB.

Files are stored in SharePoint at `/InventoryApp/orders/<orderId>/<filename>`, mirroring the existing image storage pattern in `imageOperations.ts`. Filenames are sanitized and prefixed with a uuid to prevent collisions.

### `InventoryItem` change

Add `unitOfMeasure: string` to the existing `InventoryItem` interface. One-time migration on first read: existing items default to `'each'`.

### Storage

New file `orders.json` on SharePoint, parallel to `inventory.json` and `transactions.json`. Uses the same etag-based optimistic-concurrency pattern as `inventory.json`.

### Transaction integration

Three new transaction types:

- `order-create` — emitted on PO creation
- `order-receive` — emitted on receive
- `order-cancel` — emitted on cancel

Receiving a PO ALSO emits one `stock-in` transaction per line item, so batches and FEFO consumption keep working without change. Quick-adding a new item during PO creation also emits an `item-create` transaction.

## User flows

### Flow A — Place a new order

1. User navigates to `/orders/new` (or clicks "New Order" from the orders list).
2. Fill PO header: PO# (required, unique), confirmation# (required), supplier (autocomplete), expected delivery (optional).
3. **Order docs** section (optional): drop or click to upload one or more files. Each uploaded file shows filename, size, and ✕ remove. Files are uploaded to SharePoint immediately on selection and stored as `attachments` with `stage: 'placed'`.
4. Add line items one row at a time:
   - **Item picker:** typeahead search on existing inventory by name/SKU.
   - On selecting an existing item: autofills `name`, `unitOfMeasure`, `unitCost`, and `quantityOrdered` from the most recent line item that referenced this `itemId` across all orders (regardless of status). Falls back to the item's `unitCost` if no prior orders exist.
   - On "+ Create new item" (when no match): inline mini-form with **name**, **unit of measure**, **unit cost**. App auto-generates SKU as `SKU-<6 random chars>` and creates an `InventoryItem` with `quantity: 0`, blank location/category/etc. The item appears in the line.
5. User edits qty / cost per line freely. Live total at bottom.
6. Save → Order persists with `status: 'placed'`. `order-create` transaction logged. Any newly-created stub items also emit `item-create` transactions.

### Flow B — Receive an order

1. From order detail or list, user clicks "Receive" on a `placed` PO.
2. Receive form shows each line with: ordered qty, editable **received qty** (defaults to ordered), required **lot #**, required **expiration date**.
3. **Receive docs** section (optional): drop or click to upload packing slips, invoices, photos, etc. Files attach to the order with `stage: 'received'`.
4. Submit → for each line:
   - Set `quantityReceived`, `lotNumber`, `expirationDate` on the line.
   - Emit one `stock-in` transaction → adds a batch to the corresponding `InventoryItem`.
5. Set order `status: 'received'`, `actualReceiveDate: today`. Emit `order-receive` transaction.

Receive is single-event: one click closes the PO. No partial-receive-across-multiple-events.

### Flow C — Cancel an order

Available only on `placed` POs. Confirmation modal. Status → `'cancelled'`. `order-cancel` transaction logged. No stock changes.

## UI

### Navigation

New "Orders" link in the top nav, between "Stock In/Out" and "Import".

### Routes

- `/orders` — list page
- `/orders/new` — create form
- `/orders/:id` — detail page (entry point for Receive and Cancel)

### `/orders` — Orders list

- Table columns: PO#, supplier, order date, expected delivery, status badge, line count, total $.
- Filters: status, supplier, date range.
- Sort: order date desc by default; click headers to re-sort.
- Search box: matches PO# or confirmation#.
- "+ New Order" button top-right.
- Row click → `/orders/:id`.

### `/orders/new` — Create order

- Header section: PO#, confirmation#, supplier (autocomplete), expected delivery.
- **Order docs** section: drag-and-drop area + file picker. Multiple files allowed. Each shown as a chip with filename, size, and ✕.
- Line items section: stacked rows, each with item picker → name → UoM → qty → unit cost → line total → ✕ remove. "+ Add line" button below.
- Live total at bottom of line items.
- Save / Cancel buttons.

### `/orders/:id` — Order detail

- Read-only header showing all PO fields + status badge.
- Line item table: qty ordered, qty received (if applicable), lot, expiration.
- **Attachments** section, split into two subsections: "Order docs" and "Receive docs". Each lists files with name, size, uploader, upload date, and a download link. Files can be removed (admin-only when PO is `received` or `cancelled`).
- Action buttons (depending on status):
  - `placed` → **Receive** (primary), **Cancel**, **Edit** (header + lines, until received)
  - `received` → no actions; shows `actualReceiveDate` + linked stock-in transactions
  - `cancelled` → no actions
- Activity section: timeline of order-related transactions for this PO.

### Receive form

Modal or sub-route `/orders/:id/receive`. Repeats line items with editable received qty + required lot # + required expiration date per line. Includes a **Receive docs** drag-and-drop section (optional, multiple files). Confirm → submits, redirects back to detail.

### Dashboard additions

- **Open Orders** summary card — count of `placed` POs, links to filtered list.
- **Overdue Orders** callout — any `placed` PO whose `expectedDeliveryDate` is in the past.

## Permissions

Matches existing inventory model:

- All authenticated users: create, edit, receive, cancel orders.
- Admin only: delete an order entirely. Cancel is the normal flow.

## Validation (Zod)

- `poNumber`: non-empty, trimmed, unique across `orders.json`. Error surfaces inline at save.
- `orderConfirmationNumber`: required, non-empty.
- `supplier`: required.
- At least one line item required to save the PO.
- Per line: `quantityOrdered > 0`, `unitCost >= 0`, `name` non-empty.
- Receive: `quantityReceived >= 0`, `lotNumber` non-empty, `expirationDate` parseable. Past expiration warns but does not block.
- Attachments (per file): `contentType` in allowed list (PDF, jpg/jpeg/png/heic, docx, xlsx); `sizeBytes <= 25 MB`. Reject with inline error if violated.

## Edge cases

- **Short-receive** (received < ordered): allowed, recorded as-is. Order moves to `received`. Detail page shows `"7 of 10 received"`.
- **Over-receive** (received > ordered): allowed with confirmation prompt. Recorded as-is.
- **Editing a placed order:** allowed until received. Re-validates uniqueness on save.
- **Stub items from a cancelled order:** stay in inventory with qty 0. User deletes manually if desired. Not auto-cleaned to keep behavior predictable.
- **Concurrent edits:** etag-based optimistic concurrency, same as `inventory.json`. On conflict show "Order changed elsewhere — reload?" toast.
- **Autofill source:** most recent line item for this `itemId` across all orders, regardless of status.
- **Cancelled order with attachments:** files stay on SharePoint and remain accessible from the detail page. Not auto-deleted (audit trail).
- **Failed file upload:** SharePoint upload errors surface inline; the order save is not blocked, but the failed file is dropped from the form and the user is told. Already-uploaded files in the same submission stay attached.

## Testing (Vitest)

- Schema validation for `Order` and `OrderLineItem`.
- `orderService`: create, edit, receive (full / short / over), cancel.
- Receive emits N `stock-in` transactions; verify batches land on correct items.
- PO# uniqueness enforced at save.
- Migration: existing items get `unitOfMeasure: 'each'` on first read.
- Attachment validation: rejects oversized files and disallowed content types. Accepted files round-trip through the SharePoint upload helper.

## Out of scope (YAGNI)

- Multi-lot per line at receive time
- Partial receives across multiple events
- PO templates / favorites
- Email notifications
- PO PDF export
