import { useMsal, useIsAuthenticated } from '@azure/msal-react';
import { useCallback } from 'react';
import { loginScopes, graphScopes } from './msalConfig';

export function useAuth() {
  const { instance, accounts } = useMsal();
  const isAuthenticated = useIsAuthenticated();

  const account = accounts[0] ?? null;

  const user = account
    ? {
        name: account.name ?? account.username,
        email: account.username,
        initials: (account.name ?? account.username)
          .split(/[\s.@]/)
          .filter(Boolean)
          .slice(0, 2)
          .map((s) => s[0].toUpperCase())
          .join(''),
      }
    : null;

  const login = useCallback(() => {
    return instance.loginPopup(loginScopes);
  }, [instance]);

  const logout = useCallback(() => {
    return instance.logoutPopup({ postLogoutRedirectUri: window.location.origin });
  }, [instance]);

  const getAccessToken = useCallback(async (): Promise<string> => {
    if (!account) throw new Error('Not authenticated');
    try {
      const response = await instance.acquireTokenSilent({
        ...graphScopes,
        account,
      });
      return response.accessToken;
    } catch {
      // Silent acquisition failed, fall back to popup
      const response = await instance.acquireTokenPopup(graphScopes);
      return response.accessToken;
    }
  }, [instance, account]);

  return { isAuthenticated, user, account, login, logout, getAccessToken };
}
