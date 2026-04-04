import { msalInstance } from '../auth/AuthProvider';
import { graphScopes } from '../auth/msalConfig';

export class GraphError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
  ) {
    super(message);
    this.name = 'GraphError';
  }
}

export class ConflictError extends GraphError {
  constructor(message = 'ETag conflict — file was modified by another user') {
    super(message, 412, 'conflictDetected');
    this.name = 'ConflictError';
  }
}

export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigurationError';
  }
}

export class DataLossError extends Error {
  constructor(message = 'transactions.json not found — possible accidental deletion or misconfiguration') {
    super(message);
    this.name = 'DataLossError';
  }
}

async function getToken(): Promise<string> {
  const account = msalInstance.getActiveAccount();
  if (!account) throw new Error('Not authenticated');
  try {
    const response = await msalInstance.acquireTokenSilent({
      ...graphScopes,
      account,
    });
    return response.accessToken;
  } catch {
    const response = await msalInstance.acquireTokenPopup(graphScopes);
    return response.accessToken;
  }
}

export async function graphFetch(
  url: string,
  options: RequestInit = {},
): Promise<Response> {
  const token = await getToken();

  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  });

  if (response.status === 412) {
    throw new ConflictError();
  }

  if (!response.ok) {
    let code: string | undefined;
    try {
      const body = await response.json();
      code = body?.error?.code;
    } catch { /* ignore parse errors */ }
    throw new GraphError(
      `Graph API error: ${response.status} ${response.statusText}`,
      response.status,
      code,
    );
  }

  return response;
}
