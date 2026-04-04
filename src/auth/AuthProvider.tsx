import { type ReactNode, useEffect, useState } from 'react';
import { PublicClientApplication, EventType } from '@azure/msal-browser';
import { MsalProvider } from '@azure/msal-react';
import { msalConfig } from './msalConfig';

const msalInstance = new PublicClientApplication(msalConfig);

export { msalInstance };

export default function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    msalInstance.initialize().then(() => {
      // Handle redirect promise on load (processes any pending auth redirect)
      msalInstance.handleRedirectPromise().then((response) => {
        if (response) {
          msalInstance.setActiveAccount(response.account);
        } else {
          const accounts = msalInstance.getAllAccounts();
          if (accounts.length > 0) {
            msalInstance.setActiveAccount(accounts[0]);
          }
        }
        setReady(true);
      });

      // Set active account on login success
      msalInstance.addEventCallback((event) => {
        if (event.eventType === EventType.LOGIN_SUCCESS && event.payload) {
          const payload = event.payload as { account: Parameters<typeof msalInstance.setActiveAccount>[0] };
          msalInstance.setActiveAccount(payload.account);
        }
      });
    });
  }, []);

  if (!ready) {
    return null; // Don't render until MSAL is initialized
  }

  return <MsalProvider instance={msalInstance}>{children}</MsalProvider>;
}
