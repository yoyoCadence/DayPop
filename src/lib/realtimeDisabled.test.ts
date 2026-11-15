import { createClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { RealtimeClient } from './realtimeDisabled';

// DP-263: the Vite alias must swap the real realtime-js for the stub, and the
// stub must cover every call supabase-js makes on it.
describe('Supabase Realtime stub', () => {
  const make = () => createClient('https://example.supabase.co', 'sb_publishable_test', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  it('is what supabase-js constructs, so realtime-js stays out of the bundle', () => {
    expect(make().realtime).toBeInstanceOf(RealtimeClient);
  });

  it('accepts token hand-offs and channel housekeeping without a socket', async () => {
    const client = make();
    const setAuth = vi.spyOn(client.realtime, 'setAuth');
    await client.auth.signOut();
    expect(setAuth).toHaveBeenCalledWith();
    expect(client.getChannels()).toEqual([]);
    await expect(client.removeAllChannels()).resolves.toEqual([]);
  });

  it('fails loudly if a feature subscribes', () => {
    expect(() => make().channel('daypop')).toThrow(/Realtime/);
  });
});
