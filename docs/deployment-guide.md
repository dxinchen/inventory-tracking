# Inventory Tracking App - Deployment Guide

## Prerequisites

- Azure subscription with permissions to create resources
- Git repository (GitLab) with the app source code
- Azure CLI installed locally (optional, for verification)

---

## 1. Azure AD App Registration

1. Go to **Azure Portal > Microsoft Entra ID > App registrations > New registration**.
2. Set:
   - **Name**: `Inventory Tracking App`
   - **Supported account types**: Single tenant (this org only)
   - **Redirect URI**: Select "Single-page application (SPA)" and enter `https://<your-swa-domain>.azurestaticapps.net`
3. After creation, note the **Application (client) ID** and **Directory (tenant) ID**.

### API Permissions

1. Go to **API permissions > Add a permission > Microsoft Graph**.
2. Select **Delegated permissions** and add:
   - `Sites.ReadWrite.All`
   - `User.Read`
3. Click **Grant admin consent** for the directory.

### App Roles (Admin Role)

1. Go to **App roles > Create app role**.
2. Set:
   - **Display name**: `Admin`
   - **Allowed member types**: Users/Groups
   - **Value**: `Admin`
   - **Description**: `Full administrative access`
3. Enable the role and save.
4. Assign users to the Admin role via **Enterprise applications > Inventory Tracking App > Users and groups > Add user/group**.

---

## 2. SharePoint Site Setup

1. Go to **SharePoint admin center** or create a site via the SharePoint home page.
2. Create a new **Team site** or **Communication site** for inventory data.
3. In the site's document library, create a folder named `/InventoryApp`.
4. Obtain the **Site ID** and **Drive ID**:
   - Use Graph Explorer (`https://developer.microsoft.com/graph/graph-explorer`)
   - Query: `GET https://graph.microsoft.com/v1.0/sites/{hostname}:/sites/{site-name}`
   - Note `id` from the response (this is the Site ID)
   - Query: `GET https://graph.microsoft.com/v1.0/sites/{site-id}/drives`
   - Note the `id` of the "Documents" drive (this is the Drive ID)

---

## 3. Azure Static Web Apps Setup

1. Go to **Azure Portal > Create a resource > Static Web App**.
2. Configure:
   - **Name**: `inventory-tracking` (or your preferred name)
   - **Plan type**: Free or Standard
   - **Region**: Choose closest region
   - **Deployment source**: Connect to your GitLab repository
3. Build configuration:
   - **App location**: `/`
   - **Output location**: `dist`
   - **API location**: (leave blank)
4. After creation, note the deployed URL.

### Redirect URI Update

Go back to the Azure AD App Registration and add the actual Static Web App URL as a redirect URI if it differs from what was initially set:
- `https://<your-app-name>.azurestaticapps.net`
- For local development, also add: `http://localhost:5173`

---

## 4. Environment Variables

In the Azure Static Web App resource, go to **Configuration** and add the following application settings:

| Variable | Description | Example |
|---|---|---|
| `VITE_MSAL_CLIENT_ID` | Azure AD app client ID | `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx` |
| `VITE_MSAL_TENANT_ID` | Azure AD tenant ID | `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx` |
| `VITE_SHAREPOINT_SITE_ID` | SharePoint site ID from Graph API | `contoso.sharepoint.com,guid,guid` |
| `VITE_SHAREPOINT_DRIVE_ID` | SharePoint document library drive ID | `b!xxxxxxxxxxxx` |
| `VITE_SHAREPOINT_FOLDER_PATH` | Path to the app folder in SharePoint | `/InventoryApp` |

For local development, create a `.env.local` file in the project root with the same variables.

---

## 5. Post-Deployment Verification

After deployment completes, verify the following:

- [ ] App loads at the Static Web App URL without errors
- [ ] Microsoft login redirects correctly and returns to the app
- [ ] User info (name, email) displays after sign-in
- [ ] Admin users see admin-only features (user must have Admin app role assigned)
- [ ] Inventory data loads from SharePoint (items list populates)
- [ ] CRUD operations work: create, edit, and delete inventory items
- [ ] CSV import/export functions correctly
- [ ] Navigation fallback works (refreshing on a sub-route loads the app, not a 404)
- [ ] Content-Security-Policy headers are present (check browser DevTools > Network tab)
- [ ] No console errors related to blocked resources or CORS

### Troubleshooting

- **Blank page after deploy**: Check that `dist` is set as the output location and the build succeeded.
- **MSAL redirect errors**: Verify the redirect URI in Azure AD matches the deployed URL exactly (including `https://`).
- **SharePoint 403 errors**: Confirm `Sites.ReadWrite.All` permission has admin consent granted.
- **CSP violations in console**: Review `staticwebapp.config.json` and add any missing domains to the relevant directive.
