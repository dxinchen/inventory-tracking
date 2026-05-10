# Azure Static Web Apps + SharePoint Setup

This guide covers deploying the inventory tracking app to **Azure Static Web Apps** with `transactions.json` stored in **SharePoint**, signed in with Microsoft accounts via MSAL.

For broader deployment reference (Azure portal walkthroughs, troubleshooting checklist), see [`deployment-guide.md`](./deployment-guide.md). This document focuses on the **handoff between you, your admin, and the code**.

---

## Architecture in one paragraph

The static frontend (HTML/JS/CSS) is hosted on Azure Static Web Apps. The user signs in with their Microsoft account via MSAL. After sign-in, the app calls Microsoft Graph using the user's token to read/write `transactions.json` in a SharePoint folder. There is no backend server; SharePoint is both the data store and the access-control layer. The hosting URL is public — no secrets live in the bundle.

---

## Roles and responsibilities

Three different roles are involved. Setup is much smoother once you know which person owns each piece.

| Role | Who has it | What they do for this app |
|---|---|---|
| **SharePoint Administrator** (or Site Owner) | You may already have this | Create the data folder, assign read/edit permissions to users |
| **Application Administrator** / **Cloud Application Administrator** / **Global Administrator** (Entra ID) | Usually IT / a tenant admin | Create the Entra ID app registration, register the redirect URI, grant admin consent for `Sites.ReadWrite.All` |
| **Azure subscription Contributor** | You, if you own the subscription | Create the Static Web App resource |
| **Repo Admin/Maintain** (GitHub) | You | Add Actions Variables, edit workflow |

Check your own roles at [https://entra.microsoft.com](https://entra.microsoft.com) → top-right profile → **My roles**.

**You do not need (and should not request) the admin's credentials.** They keep their identity; you just need three pieces of public information from them after they're done — see the next section.

---

## What to ask your admin

Send this message (adapt the bracketed parts):

> **Subject:** Need help registering an internal web app in Entra ID
>
> Hi [admin],
>
> I'm building an internal inventory-tracking web app. The app stores its data in a SharePoint folder; users sign in with their Microsoft account and the app reads/writes the data file on their behalf via Microsoft Graph. There's no backend — it's a static frontend that talks to SharePoint directly.
>
> I need three things from you:
>
> 1. **Create an Entra ID app registration** (or let me create it and add me as Owner). Suggested name: *Inventory Tracking*. Type: **Single-page application (SPA)**.
>
> 2. **Add this redirect URI** under Authentication → SPA platform:
>    `https://<your-azure-static-web-app>.azurestaticapps.net/`
>    (I'll give you the final URL once the SWA is provisioned.)
>
> 3. **Grant admin consent** for these delegated Microsoft Graph permissions:
>    - `User.Read` — read the signed-in user's basic profile
>    - `Sites.ReadWrite.All` — read/write SharePoint sites the **signed-in user already has access to**. This is delegated, so it never elevates beyond what each user can already do in SharePoint themselves; SharePoint folder permissions remain the real access gate.
>
> Once that's done, please send me the **Application (client) ID** and **Directory (tenant) ID** from the app's Overview page.
>
> If `Sites.ReadWrite.All` is too broad for policy, we can use `Sites.Selected` instead — happy to take that route, it's just a bit more setup.
>
> Thanks!

### Likely follow-up questions and answers

- **Why does it need write access?** Users add/update inventory records; edits get saved back to the JSON file in SharePoint.
- **Where is it hosted?** Azure Static Web Apps inside our tenant. Static frontend only.
- **Are there any secrets?** No. Public-client SPA using PKCE; no client secrets.
- **Can it be scoped to one site?** Yes, via `Sites.Selected` — admin grants per-site access via `Grant-PnPAzureADAppSitePermission`.
- **Who can see the data?** Only people granted access to the SharePoint folder. The app inherits SharePoint's permissions per user; it cannot bypass them.

### What you receive back from the admin (all public info)

| Item | Goes into |
|---|---|
| Application (client) ID | `VITE_MSAL_CLIENT_ID` |
| Directory (tenant) ID | `VITE_MSAL_TENANT_ID` |
| Confirmation that admin consent was granted | (no value, just confirm before testing) |

---

## Code changes (one-time, before first SWA deploy)

The repo currently has GitHub Pages-specific paths. Remove them so the app serves at the SWA root.

1. **`vite.config.ts`** — remove `base: '/inventory-tracking/'` (or set to `'/'`).
2. **`src/App.tsx`** — remove `basename="/inventory-tracking"` from `<BrowserRouter>`.
3. **`src/auth/msalConfig.ts`** — `redirectUri: window.location.origin` is correct as-is (the app lives at the SWA root, so `window.location.origin` matches the registered redirect URI).
4. **`staticwebapp.config.json`** — already correct: SPA fallback to `/index.html`, CSP allows `login.microsoftonline.com`, `graph.microsoft.com`, `*.sharepoint.com`.

If you want to keep the GitHub Pages workflow as a fallback, leave it; otherwise disable it (Settings → Pages → Source: None) so two deploys don't race.

---

## Step-by-step deployment

### Step 1 — SharePoint folder and permissions (you, SharePoint admin)

1. Pick (or create) the SharePoint site that will hold inventory data.
2. In its default document library, create folder `/InventoryApp`.
3. On that folder, grant:
   - **Read** to users who only view inventory
   - **Edit** to users who create/update records
4. Note the SharePoint site URL (e.g. `https://contoso.sharepoint.com/sites/inventory`).

### Step 2 — Get SharePoint Site ID and Drive ID

Sign in to [Graph Explorer](https://developer.microsoft.com/graph/graph-explorer) and run:

```
GET https://graph.microsoft.com/v1.0/sites/<tenant>.sharepoint.com:/sites/<site-name>
```

Copy the `id` field → this is `VITE_SHAREPOINT_SITE_ID` (looks like `contoso.sharepoint.com,guid,guid`).

Then:

```
GET https://graph.microsoft.com/v1.0/sites/<site-id>/drives
```

Find the document library that contains your `/InventoryApp` folder, copy its `id` → this is `VITE_SHAREPOINT_DRIVE_ID`.

### Step 3 — Admin work

Send the message above. Wait until you receive the client ID, tenant ID, and confirmation that admin consent is granted.

### Step 4 — Create the Azure Static Web App (you, Azure Contributor)

1. Azure Portal → Static Web Apps → **Create**.
2. Plan: **Free** is fine.
3. Source: connect to your GitHub repo. Let the wizard add a workflow file (something like `.github/workflows/azure-static-web-apps-<name>.yml`).
4. Build details:
   - App location: `/`
   - Output location: `dist`
   - App build command: `npm run build`
5. After creation, note:
   - The site URL (e.g. `https://<random>.azurestaticapps.net`)
   - The deployment token (auto-saved to repo Secrets as `AZURE_STATIC_WEB_APPS_API_TOKEN_<...>`)

Send the site URL back to your admin so they can register it as the redirect URI in the Entra ID app registration.

### Step 5 — Wire env vars into the build (critical)

> **Important:** The five `VITE_*` values **must** be set as build-time environment variables in GitHub Actions, **not** in the Azure Static Web App's Configuration blade. Vite bakes `VITE_*` values into the JS bundle when `npm run build` runs in CI; setting them in SWA Configuration has no effect because the build has already happened.

#### 5a. Add Repository Variables (GitHub Settings → Secrets and variables → Actions → **Variables** tab)

| Variable | Source |
|---|---|
| `VITE_MSAL_CLIENT_ID` | from admin |
| `VITE_MSAL_TENANT_ID` | from admin |
| `VITE_SHAREPOINT_SITE_ID` | step 2 |
| `VITE_SHAREPOINT_DRIVE_ID` | step 2 |
| `VITE_SHAREPOINT_FOLDER_PATH` | `/InventoryApp` |

Use **Variables** (not Secrets) — none of these are confidential in the SPA + PKCE model; they end up readable in the JS bundle either way. Real security gates: Azure AD redirect-URI matching + SharePoint folder permissions.

#### 5b. Pipe them into the build step

Edit the SWA-generated workflow (e.g. `.github/workflows/azure-static-web-apps-<name>.yml`) so the `Azure/static-web-apps-deploy@v1` step receives them:

```yaml
- name: Build And Deploy
  uses: Azure/static-web-apps-deploy@v1
  with:
    azure_static_web_apps_api_token: ${{ secrets.AZURE_STATIC_WEB_APPS_API_TOKEN_<...> }}
    repo_token: ${{ secrets.GITHUB_TOKEN }}
    action: "upload"
    app_location: "/"
    output_location: "dist"
  env:
    VITE_MSAL_CLIENT_ID: ${{ vars.VITE_MSAL_CLIENT_ID }}
    VITE_MSAL_TENANT_ID: ${{ vars.VITE_MSAL_TENANT_ID }}
    VITE_SHAREPOINT_SITE_ID: ${{ vars.VITE_SHAREPOINT_SITE_ID }}
    VITE_SHAREPOINT_DRIVE_ID: ${{ vars.VITE_SHAREPOINT_DRIVE_ID }}
    VITE_SHAREPOINT_FOLDER_PATH: ${{ vars.VITE_SHAREPOINT_FOLDER_PATH }}
```

### Step 6 — Push and verify

1. Commit the code changes from the "Code changes" section + the workflow edit. Push to `master`.
2. Watch the SWA workflow run green in the Actions tab.
3. Open `https://<your-swa>.azurestaticapps.net/`, sign in with a Microsoft account that has access to the SharePoint folder.
4. In DevTools → Network, confirm:
   - Sign-in redirect to `login.microsoftonline.com` succeeds
   - A `GET .../drives/<drive-id>/root:/InventoryApp/transactions.json` returns the file (or creates it on first use)
5. Try creating/editing an inventory record. Reload — the change should persist.

---

## Common errors and fixes

| Symptom | Cause | Fix |
|---|---|---|
| MSAL: `AADSTS50011 redirect URI mismatch` | Registered redirect URI doesn't match `window.location.origin` | Confirm trailing slash and `https://` match exactly between Azure AD and the SWA URL |
| Sign-in works but `403` from Graph | User doesn't have access to the SharePoint folder | Add them in SharePoint folder permissions |
| Sign-in works but `403` even for site owner | Admin consent not granted for `Sites.ReadWrite.All` | Admin clicks "Grant admin consent" on API permissions page |
| First user sees "Need admin approval" prompt | Admin consent not pre-granted | Same as above — admin grants tenant-wide consent once |
| Bundle loads but app is blank | `VITE_*` env vars empty in build | Confirm they're in GitHub **Variables** AND piped into the workflow's `env:` block |
| 404 on routed URLs | SPA fallback not configured | `staticwebapp.config.json` should have `"navigationFallback": { "rewrite": "/index.html" }` (already set) |

---

## Optional: tighter scope with `Sites.Selected`

If `Sites.ReadWrite.All` is rejected by your security team:

1. Admin changes the API permission from `Sites.ReadWrite.All` to `Sites.Selected` and grants admin consent.
2. Update `src/auth/msalConfig.ts` `loginScopes` and `graphScopes` to use `Sites.Selected` instead.
3. Admin (or a SharePoint admin with PnP PowerShell) runs once per site:
   ```powershell
   Grant-PnPAzureADAppSitePermission `
     -AppId <client-id> `
     -DisplayName 'Inventory Tracking' `
     -Site '<site-url>' `
     -Permissions Write
   ```
4. The app can now only access the explicitly granted site, regardless of which SharePoint sites the user has access to.

This is the safer default if your tenant has many sensitive SharePoint sites.
