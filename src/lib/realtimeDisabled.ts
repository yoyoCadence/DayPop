/**
 * Stand-in for `@supabase/realtime-js` — DP-263.
 *
 * DayPop never subscribes to Supabase Realtime: data syncs through PostgREST
 * reads and writes, and the reminder worker talks over `BroadcastChannel`.
 * supabase-js still constructs a `RealtimeClient` in every `createClient()`,
 * which pulls realtime-js and the phoenix socket into the bundle (about
 * 18.7 KB of the 240 KiB JS gzip budget). `vite.config.ts` aliases the package
 * to this module.
 *
 * Keep the surface to exactly what supabase-js 2.x calls on it: the
 * constructor, `setAuth` on every token change, and the four channel helpers
 * behind `client.channel()` and friends. `channel()` throws so a future
 * feature that needs Realtime fails loudly in development instead of silently
 * never receiving events; remove the alias in that case.
 */
export class RealtimeClient {
  constructor(endpoint: string, options?: unknown) {
    void endpoint;
    void options;
  }

  setAuth(token?: string | null): Promise<void> {
    void token;
    return Promise.resolve();
  }

  channel(): never {
    throw new Error('DayPop 沒有打包 Supabase Realtime；需要時請移除 vite.config.ts 的 realtime alias。');
  }

  getChannels(): [] {
    return [];
  }

  removeChannel(): Promise<'ok'> {
    return Promise.resolve('ok');
  }

  removeAllChannels(): Promise<'ok'[]> {
    return Promise.resolve([]);
  }
}
