import { msalInstance } from './msalInstance';

/** Throws if no MSAL account is active. */
export function getCurrentUserEmail(): string {
  const account = msalInstance.getActiveAccount();
  if (!account) throw new Error('Not authenticated');
  return account.username;
}
