import { type ReactNode, useEffect, useState } from 'react';
import LoginPage from '../components/LoginPage';

const clientId = import.meta.env.VITE_MSAL_CLIENT_ID;
const msalConfigured = Boolean(clientId && clientId !== 'not-configured');

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
    return <>{children({ userEmail: 'd.chen@biolabs.com' })}</>;
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

    async function init() {
      // Dynamic import so MSAL is only loaded when configured
      const { PublicClientApplication, EventType } = await import('@azure/msal-browser');
      const { msalConfig, loginScopes } = await import('./msalConfig');

      const msalInstance = new PublicClientApplication(msalConfig);
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

      msalInstance.addEventCallback((event) => {
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

    return () => { cancelled = true; };
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
