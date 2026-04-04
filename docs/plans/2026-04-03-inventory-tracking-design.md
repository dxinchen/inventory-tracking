# Inventory Tracking App — Design Document

**Date:** 2026-04-03
**Status:** Draft

## Problem

A team of 5 needs to track physical product inventory (receiving and consuming stock) with full audit trails, low stock alerts, and expiration tracking. The solution should use Microsoft 365 infrastructure the team already has.

## Architecture

### Stack

- **Frontend:** React SPA (TypeScript)
- **Backend:** None — browser talks directly to Microsoft Graph API
- **Storage:** JSON files in a shared OneDrive folder
- **Auth:** Microsoft SSO via MSAL
- **Hosting:** Azure Static Web Apps (free tier)
- **Build tool:** Vite

### How It Works

1. User opens the app and signs in with their Microsoft 365 account
2. MSAL acquires a token with OneDrive read/write permissions
3. The app reads/writes JSON files in a shared OneDrive folder (`/InventoryApp/`) via Microsoft Graph API
4. All 5 team members share the same OneDrive folder, so everyone sees the same data

### Data Files in OneDrive

```
/InventoryApp/
  inventory.json      — all items
  transactions.json   — stock-in / stock-out log
  images/             — product images (referenced by filename)
```

## Data Models

### Inventory Item (`inventory.json`)

```json
{
  "items": [
    {
      "id": "uuid",
      "sku": "WDG-001",
      "name": "Blue Widget",
      "quantity": 150,
      "location": "Warehouse A, Shelf 3",
      "category": "Widgets",
      "supplier": "Acme Corp",
      "unitCost": 4.99,
      "reorderPoint": 50,
      "expirationDate": "2027-03-15",
      "imageFilename": "wdg-001.jpg",
      "createdBy": "user@company.com",
      "updatedAt": "2026-04-03T10:30:00Z"
    }
  ]
}
```

### Transaction (`transactions.json`)

```json
{
  "transactions": [
    {
      "id": "uuid",
      "itemId": "uuid",
      "type": "stock-in | stock-out",
      "quantity": 50,
      "note": "Received from Acme, PO #1234",
      "performedBy": "user@company.com",
      "timestamp": "2026-04-03T10:30:00Z"
    }
  ]
}
```

### Key Decisions

- `quantity` on the item is the current balance, updated on every transaction
- Transaction log provides full audit trail (who, what, when)
- `imageFilename` references files in the `images/` OneDrive folder
- `performedBy` is auto-populated from the Microsoft SSO login

## UI Screens

### 1. Dashboard

- Total item count and total inventory value (qty x unit cost)
- Low stock alerts: items at or below reorder point
- Expiring soon: items expiring within 30 days
- Recent activity feed (last 10 transactions)

### 2. Inventory List

- Searchable, sortable, filterable table of all items
- Filters: category, location, supplier, stock status (normal / low / out)
- Inline quick-edit for quantity adjustments
- Click row to open item detail (full edit, image, transaction history)

### 3. Stock In / Stock Out

- Single form with toggle for direction (receiving vs. using)
- Search/select item by SKU or name
- Enter quantity and optional note
- Submit updates both `inventory.json` and `transactions.json`

### 4. Export

- Export current inventory to .xlsx or .csv
- Export transaction log to .xlsx or .csv
- Date range filter for transaction export

### Navigation

- Top bar with: Dashboard, Inventory, Stock In/Out, Export
- Logged-in user name + sign out button

## Concurrency Handling

### ETag-Based Conflict Detection

1. On every read, the app stores the eTag returned by Microsoft Graph API
2. On write, it sends the eTag as an `If-Match` header
3. If the file changed since the last read, Graph API returns `412 Conflict`
4. On conflict: re-fetch the latest file, re-apply the user's change, retry (up to 3 attempts)

### Why This Works for 5 Users

- Most edits touch different items — re-applying to fresh data almost always succeeds
- Transaction log is append-only — merging means adding the new entry
- With 5 users, same-item-same-moment conflicts are rare

## Error Handling

- OneDrive unreachable: clear error banner, no silent failures
- No offline mode: if OneDrive is down, the app shows an error state
- All API errors surfaced as user-friendly toast notifications

## Alerts

- Low stock and expiration alerts are checked client-side on every data load
- No push notifications: users see alerts when they open the app

## Tech Dependencies

| Package | Purpose |
|---------|---------|
| `react`, `react-dom` | UI framework |
| `@azure/msal-browser`, `@azure/msal-react` | Microsoft SSO |
| `@microsoft/microsoft-graph-client` | OneDrive file operations |
| `@tanstack/react-table` | Sortable/filterable inventory table |
| `react-router-dom` | Page navigation |
| `xlsx` | Export to Excel/CSV |
| `uuid` | Generate item and transaction IDs |
| `vite` | Build tool |

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
  models/         — TypeScript types for Item, Transaction
  utils/          — conflict resolution, date helpers
  App.tsx         — router + layout
  main.tsx        — entry point
```

## Azure Setup

### 1. Azure AD App Registration (one-time)

1. Go to Azure Portal > Entra ID > App registrations > New registration
2. Name: "Inventory Tracking App"
3. Supported account types: "Accounts in this organizational directory only"
4. Redirect URI: `http://localhost:5173` (dev) and your production URL
5. Under API permissions, add Microsoft Graph > Delegated:
   - `Files.ReadWrite.All` (read/write OneDrive files)
   - `User.Read` (get logged-in user info)
6. Copy the Application (client) ID — this goes in the app's MSAL config

### 2. Shared OneDrive Folder

1. One team member creates `/InventoryApp/` in their OneDrive
2. Share the folder with the other 4 team members (edit access)
3. The app reads/writes to this shared folder via Graph API

### 3. Azure Static Web Apps Deployment

1. Create a Static Web App resource in Azure Portal (free tier)
2. Connect it to your git repository
3. Set app location to `/` and output location to `dist`
4. Azure auto-deploys on every push
5. No custom domain name required — Azure provides a URL like `https://<auto-generated-name>.azurestaticapps.net`
