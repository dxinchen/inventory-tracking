import type { Configuration } from '@azure/msal-browser';
import { LogLevel } from '@azure/msal-browser';

const clientId = import.meta.env.VITE_MSAL_CLIENT_ID;
const tenantId = import.meta.env.VITE_MSAL_TENANT_ID;

if (!clientId) {
  console.warn('[MSAL] VITE_MSAL_CLIENT_ID not set — auth will not work');
}

export const msalConfig: Configuration = {
  auth: {
    clientId: clientId || 'not-configured',
    authority: `https://login.microsoftonline.com/${tenantId || 'common'}`,
    redirectUri: window.location.origin,
    postLogoutRedirectUri: window.location.origin,
  },
  cache: {
    cacheLocation: 'sessionStorage',
  },
  system: {
    loggerOptions: {
      logLevel: LogLevel.Warning,
      loggerCallback: (_level, message) => {
        console.debug(`[MSAL] ${message}`);
      },
    },
  },
};

export const loginScopes = {
  scopes: ['User.Read', 'Sites.ReadWrite.All'],
};

export const graphScopes = {
  scopes: ['Sites.ReadWrite.All'],
};
