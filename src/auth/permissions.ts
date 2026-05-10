import { msalInstance } from './msalInstance';

/**
 * Role-based access control via Azure AD App Roles.
 *
 * Setup in Azure Portal → Entra ID → App registrations → your app → App roles:
 *   1. Create role: Display name "Admin", Value "Admin", Allowed member types "Users/Groups"
 *   2. Go to Enterprise applications → your app → Users and roles → Add user/group
 *   3. Assign specific users or a security group to the "Admin" role
 *
 * Admin-only actions: bulk CSV import
 * All authenticated users can: add/edit/delete items, record stock in/out
 */

const ADMIN_ROLE = 'Admin';

/**
 * Fallback list for local development when Azure AD roles aren't configured.
 * In production, roles come from the token — this list is ignored.
 */
const DEV_ADMINS: string[] = [
  'xdu@mabwell-therapeutics.com',
];

export function isAdmin(email?: string): boolean {
  // 1. Check Azure AD app roles from the active account's token claims
  const account = msalInstance.getActiveAccount();
  if (account) {
    const roles = (account.idTokenClaims as Record<string, unknown>)?.roles;
    if (Array.isArray(roles)) {
      return roles.includes(ADMIN_ROLE);
    }
  }

  // 2. Fallback: check dev admins list (for local dev without Azure AD)
  if (!email) return false;
  return DEV_ADMINS.includes(email.toLowerCase());
}
