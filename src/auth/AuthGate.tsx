import { type ReactNode, useEffect, useState } from 'react';
import { EventType } from '@azure/msal-browser';
import LoginPage from '../components/LoginPage';
import { msalConfigured, loginScopes } from './msalConfig';
import { msalInstance } from './msalInstance';

interface AuthGateProps {
  children: (ctx: { userEmail: string; onLogout?: () => void }) => ReactNode;
}

/**
 * AuthGate wraps the app and handles two modes:
 *
 * 1. MSAL configured (VITE_MSAL_CLIENT_ID set):
 *    - Initializes MSAL, shows LoginPage until authenticated
 *    - Passes real user email and logout function to children
 *
 * 2. Dev mode (no client ID):
 *    - Skips auth entirely, uses mock email
 *    - App is immediately accessible
 */
export default function AuthGate({ children }: AuthGateProps) {
  if (!msalConfigured) {
    // Dev mode — no MSAL, skip auth
    return <>{children({ userEmail: 'chendong@gmail.com' })}</>;
  }

  // MSAL mode — dynamically import to avoid crashing when not configured
  return <MsalAuthGate>{children}</MsalAuthGate>;
}

function MsalAuthGate({ children }: AuthGateProps) {
  const [state, setState] = useState<
    | { status: 'loading' }
    | { status: 'unauthenticated'; login: () => void }
    | { status: 'authenticated'; email: string; logout: () => void }
  >({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    let callbackId: string | null = null;

    async function init() {
      await msalInstance.initialize();

      const response = await msalInstance.handleRedirectPromise();
      if (response) {
        msalInstance.setActiveAccount(response.account);
      } else {
        const accounts = msalInstance.getAllAccounts();
        if (accounts.length > 0) {
          msalInstance.setActiveAccount(accounts[0]);
        }
      }

      callbackId = msalInstance.addEventCallback((event) => {
        if (event.eventType === EventType.LOGIN_SUCCESS && event.payload) {
          const payload = event.payload as { account: Parameters<typeof msalInstance.setActiveAccount>[0] };
          msalInstance.setActiveAccount(payload.account);
          if (!cancelled) {
            setState({
              status: 'authenticated',
              email: payload.account?.username ?? '',
              logout: () => msalInstance.logoutPopup(),
            });
          }
        }
      });

      if (cancelled) return;

      const account = msalInstance.getActiveAccount();
      if (account) {
        setState({
          status: 'authenticated',
          email: account.username,
          logout: () => msalInstance.logoutPopup(),
        });
      } else {
        setState({
          status: 'unauthenticated',
          login: () => msalInstance.loginPopup(loginScopes),
        });
      }
    }

    init().catch((err) => {
      console.error('[Auth] MSAL init failed:', err);
      if (!cancelled) {
        // Fall back to unauthenticated with a no-op login that shows the error
        setState({
          status: 'unauthenticated',
          login: () => { window.alert(`Authentication error: ${err.message}`); },
        });
      }
    });

    return () => {
      cancelled = true;
      // Without removal, StrictMode dev double-mount accumulates callbacks.
      if (callbackId) msalInstance.removeEventCallback(callbackId);
    };
  }, []);

  if (state.status === 'loading') {
    return (
      <div className="login-page">
        <div className="login-card">
          <div className="login-brand">
            <span className="nav-brand-name">Inventory</span>
            <span className="nav-brand-tag">Tracker</span>
          </div>
          <p className="login-subtitle">Connecting to Microsoft 365...</p>
        </div>
      </div>
    );
  }

  if (state.status === 'unauthenticated') {
    return <LoginPage onSignIn={state.login} />;
  }

  return <>{children({ userEmail: state.email, onLogout: state.logout })}</>;
}
