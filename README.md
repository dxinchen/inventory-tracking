# Inventory Tracker

A biolab inventory tracking app built with React + TypeScript + Vite. Tracks supplies with lot/batch-level expiration, FEFO consumption, and full audit trails. Designed for a team of 5 using Microsoft 365 infrastructure.

## Quick Start

```bash
npm install
npm run dev
```

Open http://localhost:5173. In dev mode, auth is skipped and mock data is loaded automatically.

## Features

- **Dashboard** -- summary cards, low stock alerts, recent activity, expiring batches
- **Inventory List** -- search, sort, filter by category/status, click to view details
- **Item Detail** -- view/edit all fields, lot/batch inventory, per-item activity log
- **Stock In/Out** -- record receiving and usage with lot number and expiration date
- **Import** -- bulk CSV import (admin only), append or overwrite mode with preview
- **Export** -- download inventory or transaction log as CSV

## Importing Items via CSV

A sample CSV file is included at [`public/sample-import.csv`](public/sample-import.csv).

### CSV Columns

| Column | Required | Example |
|--------|----------|---------|
| SKU | Yes | `RNA-EXT` |
| Name | Yes | `RNeasy Mini Kit (50)` |
| Quantity | No (defaults to 0) | `12` |
| Location | No | `Room 103 Shelf A1` |
| Category | No | `Assay Kits` |
| Supplier | No | `Qiagen` |
| Vendor | No | `Qiagen N.V.` |
| Reference Number | No | `PO-2026-0050` |
| Unit Cost | No | `249.00` |
| Reorder Point | No (defaults to 0) | `5` |
| Expiration Date | No | `2027-02-28` |

### How to Import

1. Go to the **Import** page (admin only)
2. Drop a CSV file or click to browse
3. The preview table shows each row as **New** (will be created) or **Skip** (SKU already exists)
4. Optionally check **Overwrite existing** to update items that already exist (a warning will appear)
5. Click **Import N Items**

### Creating a CSV from Scratch

You can download a blank template from the **Export** page (click "Download Template"), fill it in using Excel or Numbers, and import it.

## Lot / Batch Tracking

Each stock-in records a **lot number** and **expiration date**. When stock is consumed (stock-out), the app uses **FEFO** (First Expired, First Out) -- the earliest-expiring batch is consumed first. The dashboard's "Expiring Soon" section shows individual batches, not rolled-up SKUs.

## Permissions

- **All authenticated users** can add, edit, delete items and record stock in/out
- **Admins only** can bulk import via CSV

Admin access is controlled through **Azure AD App Roles**. In local dev, admins are defined in `src/auth/permissions.ts`.

## Tech Stack

- React 19 + TypeScript
- Vite (build + dev server)
- Microsoft SSO via MSAL (optional in dev)
- SharePoint document library via Microsoft Graph API (storage)
- Zod (runtime schema validation)
- Vitest (54 tests)

## Deployment

### Step 1: Azure AD App Registration

1. Go to **Azure Portal > Microsoft Entra ID > App registrations > New registration**
2. Name: `Inventory Tracking App`, Single tenant
3. Redirect URI: select **Single-page application (SPA)** and enter `http://localhost:5173` (you'll add the production URL later)
4. After creation, copy the **Application (client) ID** and **Directory (tenant) ID**
5. Go to **API permissions > Add a permission > Microsoft Graph > Delegated**:
   - `Sites.ReadWrite.All`
   - `User.Read`
6. Click **Grant admin consent**
7. Go to **App roles > Create app role**:
   - Display name: `Admin`, Value: `Admin`, Allowed member types: Users/Groups
8. Assign admin users via **Enterprise applications > your app > Users and groups**

### Step 2: SharePoint Site

1. Create a SharePoint team site (or use an existing one)
2. In the document library, create a folder called `/InventoryApp`
3. Get the **Site ID** and **Drive ID** using [Graph Explorer](https://developer.microsoft.com/graph/graph-explorer):
   - `GET https://graph.microsoft.com/v1.0/sites/{hostname}:/sites/{site-name}` -- copy the `id`
   - `GET https://graph.microsoft.com/v1.0/sites/{site-id}/drives` -- copy the `id` of the Documents drive

### Step 3: Environment Variables

Create a `.env` file (copy from `.env.example`):

```
VITE_MSAL_CLIENT_ID=your-client-id-here
VITE_MSAL_TENANT_ID=your-tenant-id-here
VITE_SHAREPOINT_SITE_ID=contoso.sharepoint.com,guid,guid
VITE_SHAREPOINT_DRIVE_ID=b!xxxxxxxxxxxx
VITE_SHAREPOINT_FOLDER_PATH=/InventoryApp
```

When `VITE_MSAL_CLIENT_ID` is not set, the app runs in dev mode with mock data and no authentication.

### Step 4: Deploy to Azure Static Web Apps

1. Go to **Azure Portal > Create a resource > Static Web App**
2. Connect to your git repository
3. Build settings:
   - App location: `/`
   - Output location: `dist`
4. Add environment variables in **Configuration** (same as `.env` above)
5. Add your production URL (`https://<name>.azurestaticapps.net`) as a redirect URI in the Azure AD app registration
6. Push to deploy -- Azure auto-builds on every push

### Step 5: Verify

- [ ] App loads without blank screen
- [ ] Microsoft login works and redirects back
- [ ] User name shows in the nav bar after login
- [ ] Inventory loads from SharePoint
- [ ] Create, edit, delete items works
- [ ] Stock in/out updates quantities and batches
- [ ] CSV import works for admin users
- [ ] Export downloads CSV files
- [ ] Refreshing on a sub-route (e.g. `/inventory`) loads correctly (not 404)

See [`docs/deployment-guide.md`](docs/deployment-guide.md) for detailed troubleshooting.
