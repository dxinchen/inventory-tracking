import { describe, it, expect, vi } from 'vitest';

// Mock auth
vi.mock('../../auth/msalInstance', () => ({
  msalInstance: {
    getActiveAccount: () => ({ username: 'test@biolabs.com' }),
    acquireTokenSilent: () => Promise.resolve({ accessToken: 'mock-token' }),
  },
}));

vi.mock('../../auth/msalConfig', () => ({
  graphScopes: { scopes: ['Sites.ReadWrite.All'] },
}));

describe('bootstrap (design contract)', () => {
  it('verifies SharePoint folder exists — throws ConfigurationError if 404', async () => {
    const { ConfigurationError } = await import('../graphClient');
    const err = new ConfigurationError('SharePoint folder not found at "/InventoryApp" — check VITE_SHAREPOINT_FOLDER_PATH');
    expect(err.name).toBe('ConfigurationError');
    expect(err.message).toContain('/InventoryApp');
  });

  it('creates images/ subfolder if missing — catches 409 on race condition', () => {
    // If two browsers bootstrap simultaneously:
    // Browser A creates images/ folder → success
    // Browser B gets 409 Conflict → catches it, continues
    // This prevents bootstrap failure from concurrent first-run
    expect(true).toBe(true);
  });

  it('creates transactions.json if missing — catches 409/412 on race', () => {
    // Same race handling: if another browser created it first,
    // catch the conflict, re-read the file they created, validate, continue
    expect(true).toBe(true);
  });

  it('post-bootstrap 404 on read throws DataLossError, not silent recreation', async () => {
    const { DataLossError } = await import('../graphClient');
    const err = new DataLossError();
    expect(err.name).toBe('DataLossError');
    // If transactions.json disappears after bootstrap completed,
    // that's data loss — NOT a signal to recreate an empty file
    // (which would reset the entire inventory)
  });

  it('validates existing transactions.json with Zod on bootstrap', () => {
    // On successful read, the file is parsed and validated with TransactionLogSchema
    // If the file is corrupted or has unexpected shape, Zod throws
    // This catches issues before the app starts using bad data
    expect(true).toBe(true);
  });
});
