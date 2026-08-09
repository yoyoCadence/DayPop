import { act } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DataProvider } from '../data/DataProvider';
import type { Database, Json } from '../lib/database.types';
import { MemoryStorage } from '../storage/browserStorage';
import { LegacyImportProvider } from './LegacyImportProvider';
import { useLegacyImport, type LegacyImportContextValue } from './legacyImportContext';
import { LEGACY_STORAGE_KEY } from './legacyImport';

const ACCOUNT_ID = '11111111-1111-4111-8111-111111111111';
let container: HTMLDivElement;
let root: Root;
const seen: LegacyImportContextValue[] = [];

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  seen.length = 0;
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function Probe() {
  const value = useLegacyImport();
  seen.push(value);
  return <span>{value.state.status}</span>;
}

function latest(): LegacyImportContextValue {
  const value = seen.at(-1);
  if (!value) throw new Error('probe never rendered');
  return value;
}

describe('LegacyImportProvider', () => {
  it('keeps the original bytes and sends only a fingerprint plus sanitized payload', async () => {
    const raw = JSON.stringify({
      calendars: [{ id: 'old', name: '舊日曆', color: '#123456' }],
      events: [],
      todos: [],
      stickers: [],
      settings: { aiKey: 'never-send-me', tz: 'Asia/Taipei' },
    });
    const storage = new MemoryStorage();
    storage.setItem(LEGACY_STORAGE_KEY, raw);
    const rpcCalls: Array<{ name: string; args: Record<string, Json | undefined> }> = [];
    const client = {
      from() {
        const result = Promise.resolve({
          data: { legacy_imported_at: null },
          error: null,
        });
        const query = {
          select: () => query,
          eq: () => query,
          single: () => result,
        };
        return query;
      },
      async rpc(name: string, args: Record<string, Json | undefined>) {
        rpcCalls.push({ name, args });
        return {
          data: { status: 'imported', imported_at: '2026-08-09T03:00:00.000Z' },
          error: null,
        };
      },
    } as unknown as SupabaseClient<Database>;

    await act(async () => {
      root.render(
        <DataProvider>
          <LegacyImportProvider accountId={ACCOUNT_ID} client={client} storage={storage}>
            <Probe />
          </LegacyImportProvider>
        </DataProvider>,
      );
    });
    expect(latest().state.status).toBe('ready');

    await act(async () => {
      await latest().importLegacy();
    });

    expect(storage.getItem(LEGACY_STORAGE_KEY)).toBe(raw);
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0]?.name).toBe('import_legacy_daypop');
    expect(rpcCalls[0]?.args.p_fingerprint).toMatch(/^[0-9a-f]{64}$/);
    const payload = JSON.stringify(rpcCalls[0]?.args.p_payload);
    expect(payload).not.toContain('aiKey');
    expect(payload).not.toContain('never-send-me');
    expect(latest().state.status).toBe('imported');
  });

  it('keeps a failed import retryable without changing the original bytes', async () => {
    const raw = JSON.stringify({
      calendars: [{ id: 'old', name: '舊日曆', color: '#123456' }],
      events: [],
      todos: [],
      stickers: [],
      settings: { tz: 'Asia/Taipei' },
    });
    const storage = new MemoryStorage();
    storage.setItem(LEGACY_STORAGE_KEY, raw);
    let attempts = 0;
    const client = {
      from() {
        const result = Promise.resolve({
          data: { legacy_imported_at: null },
          error: null,
        });
        const query = {
          select: () => query,
          eq: () => query,
          single: () => result,
        };
        return query;
      },
      async rpc() {
        attempts += 1;
        return attempts === 1
          ? { data: null, error: { message: 'temporary network failure' } }
          : {
              data: { status: 'imported', imported_at: '2026-08-09T03:00:00.000Z' },
              error: null,
            };
      },
    } as unknown as SupabaseClient<Database>;

    await act(async () => {
      root.render(
        <DataProvider>
          <LegacyImportProvider accountId={ACCOUNT_ID} client={client} storage={storage}>
            <Probe />
          </LegacyImportProvider>
        </DataProvider>,
      );
    });

    await act(async () => {
      await latest().importLegacy();
    });
    expect(latest().state).toMatchObject({
      status: 'failed',
      message: 'temporary network failure',
    });
    expect(storage.getItem(LEGACY_STORAGE_KEY)).toBe(raw);

    await act(async () => {
      await latest().importLegacy();
    });
    expect(attempts).toBe(2);
    expect(latest().state.status).toBe('imported');
    expect(storage.getItem(LEGACY_STORAGE_KEY)).toBe(raw);
  });
});
