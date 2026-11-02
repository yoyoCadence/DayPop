import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Session } from '@supabase/supabase-js';
import { AuthContext, useAuth, type AuthContextValue } from '../auth/authContext';
import type { ReminderDeviceView, ReminderIdentity } from './deviceController';
import { ReminderProvider } from './ReminderProvider';
import { useReminders } from './reminderContext';
import { ReminderError, type ReminderRuleInput, type ReminderService } from './reminderService';

const A = '00000000-0000-4000-8000-000000000231', B = '00000000-0000-4000-8000-000000000232';
const KEY = 'B' + 'A'.repeat(86), NOW = '2026-11-01T01:00:00.000Z';
const input: ReminderRuleInput = { calendarId: A, minutesBefore: [10], timezone: 'Asia/Taipei', dateTime: '09:00', includeTodos: false };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
const empty: ReminderDeviceView = { userId: null, phase: 'waiting', canEnable: false, deviceId: null, pendingCount: 0, error: null, snapshot: null };
let root: Root | undefined, container: HTMLDivElement | undefined;
afterEach(async () => { if (root) await act(async () => root!.unmount()); container?.remove(); root = undefined; container = undefined; vi.restoreAllMocks(); vi.useRealTimers(); });
function setup() {
  let view = { ...empty };
  const listeners = new Set<() => void>(), seen: ReminderDeviceView[] = [], order: string[] = [];
  const emit = (patch: Partial<ReminderDeviceView>) => { view = { ...view, ...patch }; for (const listener of listeners) listener(); };
  const controller = {
    getSnapshot: () => view, subscribe: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); },
    setIdentity: vi.fn(async (identity: ReminderIdentity) => {
      emit({ ...empty, userId: identity.kind === 'account' ? identity.userId : null, phase: identity.kind === 'account' ? 'ready' : identity.kind });
    }), refresh: vi.fn(async () => {}), enable: vi.fn(async () => true),
    disable: vi.fn(async () => { order.push('cleanup'); return true; }), invalidatePreflight: vi.fn(),
  };
  const service = { load: vi.fn(), capabilities: vi.fn(), setRule: vi.fn(async () => ({ ...input, updatedAt: NOW })),
    registerDevice: vi.fn(), registerDeviceLease: vi.fn(), unregisterDevice: vi.fn(), captureDeviceRemoval: vi.fn() } satisfies ReminderService;
  const serviceForUser = vi.fn(() => service), createController = vi.fn(() => controller);
  const makeAuth = (userId: string | null = A, token = 'synthetic-token'): AuthContextValue => ({
    user: userId ? { id: userId } as Session['user'] : null,
    session: userId ? { user: { id: userId }, access_token: token } as Session : null,
    initializing: false, sessionUnconfirmed: false, configurationError: null, isPasswordRecovery: false, googleAuthStatus: 'disabled',
    signIn: vi.fn(), signUp: vi.fn(), signInWithGoogle: vi.fn(), requestPasswordReset: vi.fn(), updatePassword: vi.fn(), dismissPasswordRecovery: vi.fn(),
    signOut: vi.fn(async () => { order.push('signout'); }),
  });
  let auth = makeAuth(), bridge: ReturnType<typeof useReminders> = null, wrapped: AuthContextValue | undefined;
  function Probe() {
    bridge = useReminders(); wrapped = useAuth(); seen.push(bridge!.view);
    return <div data-account={wrapped.user?.id ?? 'guest'}>{bridge!.view.userId}:{bridge!.view.phase}</div>;
  }
  const render = async (next = auth, strict = false) => {
    auth = next;
    if (!container) { container = document.createElement('div'); document.body.append(container); root = createRoot(container); }
    const element = <AuthContext.Provider value={auth}><ReminderProvider createController={createController} serviceForUser={serviceForUser}>
      <Probe key={auth.user?.id ?? 'guest'} />
    </ReminderProvider></AuthContext.Provider>;
    await act(async () => root!.render(strict ? <StrictMode>{element}</StrictMode> : element));
  };
  return { controller, service, serviceForUser, createController, emit, seen, order, makeAuth, render,
    get bridge() { return bridge!; }, get wrapped() { return wrapped!; }, get auth() { return auth; } };
}
describe('reminder host and Auth bridge (DP-231)', () => {
  it('maps waiting, unconfirmed cached account, guest and confirmed account without automatic consent', async () => {
    const h = setup(); await h.render({ ...h.makeAuth(), initializing: true }); expect(h.controller.setIdentity).toHaveBeenLastCalledWith({ kind: 'waiting' });
    await h.render({ ...h.makeAuth(), sessionUnconfirmed: true }); expect(h.controller.setIdentity).toHaveBeenLastCalledWith({ kind: 'waiting' });
    await h.render(h.makeAuth(null)); expect(h.controller.setIdentity).toHaveBeenLastCalledWith({ kind: 'guest' });
    await h.render(h.makeAuth()); expect(h.controller.setIdentity).toHaveBeenLastCalledWith({ kind: 'account', userId: A, service: h.service });
    expect(h.controller.enable).not.toHaveBeenCalled(); expect(h.service.setRule).not.toHaveBeenCalled();
  });
  it('refreshes captured cleanup after token refresh without changing the runtime or revoking', async () => {
    const h = setup(); await h.render(); await h.render(h.makeAuth(A, 'synthetic-refreshed'));
    expect(h.createController).toHaveBeenCalledTimes(1); expect(h.controller.setIdentity).toHaveBeenCalledTimes(2);
    expect(h.serviceForUser).toHaveBeenCalledTimes(1); expect(h.controller.disable).not.toHaveBeenCalled();
  });
  it('hides A data on the very first B render, before the identity effect, and retains the runtime across keyed remount', async () => {
    const h = setup(); await h.render();
    await act(async () => h.emit({ userId: A, phase: 'active', deviceId: A, snapshot: { capabilities: { enabled: true, publicKey: KEY, lastTick: NOW }, rules: [{ ...input, updatedAt: NOW }], devices: [] } }));
    const start = h.seen.length; await h.render(h.makeAuth(B));
    expect(h.seen.slice(start).every(view => view.userId === B && view.deviceId === null && view.snapshot === null)).toBe(true);
    expect(h.createController).toHaveBeenCalledTimes(1);
  });
  it('awaits cleanup before real signout and coalesces repeated signout actions', async () => {
    const h = setup(), cleanup = deferred<boolean>(); h.controller.disable.mockReturnValue(cleanup.promise); await h.render();
    let first!: Promise<void>, second!: Promise<void>;
    await act(async () => { first = h.wrapped.signOut(); second = h.wrapped.signOut(); });
    expect(first).toBe(second); expect(h.auth.signOut).not.toHaveBeenCalled(); expect(h.controller.disable).toHaveBeenCalledTimes(1);
    await act(async () => { cleanup.resolve(true); await first; }); expect(h.auth.signOut).toHaveBeenCalledTimes(1);
  });
  it('allows signout after unconfirmed cleanup and preserves its warning in guest state', async () => {
    const h = setup(); h.controller.disable.mockImplementation(async () => { h.emit({ pendingCount: 1, phase: 'unconfirmed', error: '尚未確認停用' }); return false; });
    await h.render(); await act(async () => { await h.wrapped.signOut(); }); expect(h.auth.signOut).toHaveBeenCalledTimes(1);
    h.controller.setIdentity.mockImplementation(async () => { h.emit({ ...empty, phase: 'unconfirmed', pendingCount: 1, error: '尚未確認停用' }); });
    await h.render(h.makeAuth(null)); expect(h.bridge.view).toMatchObject({ phase: 'unconfirmed', userId: null, pendingCount: 1, error: '尚未確認停用' });
  });
  it('does not sign B out if A cleanup finishes after an external account switch', async () => {
    const h = setup(), cleanup = deferred<boolean>(); h.controller.disable.mockReturnValue(cleanup.promise); await h.render();
    const old = h.wrapped.signOut().catch(error => error); const b = h.makeAuth(B); await h.render(b);
    cleanup.resolve(true); expect(await old).toBeInstanceOf(ReminderError); expect(b.signOut).not.toHaveBeenCalled();
  });
  it('does not sign a new A session out after the original A action crossed through B', async () => {
    const h = setup(), cleanup = deferred<boolean>(); h.controller.disable.mockReturnValue(cleanup.promise); await h.render();
    const old = h.wrapped.signOut().catch(error => error); await h.render(h.makeAuth(B)); const newA = h.makeAuth(A, 'synthetic-new-login'); await h.render(newA);
    cleanup.resolve(true); expect(await old).toBeInstanceOf(ReminderError); expect(newA.signOut).not.toHaveBeenCalled();
  });
  it('coalesces signout only for the same identity, allowing B to explicitly sign out while A cleanup finishes', async () => {
    const h = setup(), cleanup = deferred<boolean>(); h.controller.disable.mockReturnValue(cleanup.promise); await h.render();
    const old = h.wrapped.signOut().catch(error => error); const b = h.makeAuth(B); await h.render(b); const current = h.wrapped.signOut();
    cleanup.resolve(true); expect(await old).toBeInstanceOf(ReminderError); await current;
    expect(h.controller.disable).toHaveBeenCalledTimes(2); expect(b.signOut).toHaveBeenCalledTimes(1);
  });
  it('never revokes on StrictMode replay or unmount, and detaches lifecycle listeners', async () => {
    const h = setup(); await h.render(h.makeAuth(), true); expect(h.controller.disable).not.toHaveBeenCalled();
    await act(async () => root!.unmount()); root = undefined;
    window.dispatchEvent(new Event('online')); expect(h.controller.refresh).not.toHaveBeenCalled(); expect(h.controller.disable).not.toHaveBeenCalled();
  });
  it('invalidates relevant storage/worker changes and refreshes on reconnection, ignoring unrelated keys', async () => {
    const h = setup(); await h.render();
    await act(async () => window.dispatchEvent(new StorageEvent('storage', { key: 'daypop.user-data' }))); expect(h.controller.refresh).not.toHaveBeenCalled();
    const scope = new URL(import.meta.env.BASE_URL, window.location.href).href;
    await act(async () => window.dispatchEvent(new StorageEvent('storage', { key: 'daypop.reminder-device.' + encodeURIComponent(scope) + '.operation' })));
    expect(h.controller.invalidatePreflight).toHaveBeenCalledTimes(1); expect(h.controller.refresh).toHaveBeenCalledTimes(1);
    await act(async () => window.dispatchEvent(new Event('online'))); expect(h.controller.refresh).toHaveBeenCalledTimes(2);
  });
  it('saves a rule with its exact CAS then refreshes, preserving rejected writes and preventing double submit', async () => {
    const h = setup(), save = deferred<{ updatedAt: string } & ReminderRuleInput>(); h.service.setRule.mockReturnValueOnce(save.promise); await h.render();
    let operation!: Promise<unknown>; await act(async () => { operation = h.bridge.saveRule(input, NOW); });
    expect(h.bridge.savingRule).toBe(true); await expect(h.bridge.saveRule(input, NOW)).rejects.toMatchObject({ kind: 'conflict' });
    expect(h.service.setRule).toHaveBeenCalledWith(input, NOW);
    await act(async () => { save.resolve({ ...input, updatedAt: NOW }); await operation; });
    expect(h.controller.refresh).toHaveBeenCalledTimes(1); expect(h.bridge.savingRule).toBe(false);
    h.service.setRule.mockRejectedValueOnce(new ReminderError('conflict', '設定已變更'));
    await act(async () => { await expect(h.bridge.saveRule(input, NOW)).rejects.toMatchObject({ kind: 'conflict' }); }); expect(h.bridge.savingRule).toBe(false);
  });
  it('rejects a late A rule response without refreshing or exposing it under B', async () => {
    const h = setup(), save = deferred<{ updatedAt: string } & ReminderRuleInput>(); h.service.setRule.mockReturnValueOnce(save.promise); await h.render();
    const operation = h.bridge.saveRule(input, NOW).catch(error => error); await h.render(h.makeAuth(B));
    await act(async () => { save.resolve({ ...input, updatedAt: NOW }); }); expect(await operation).toBeInstanceOf(ReminderError);
    expect(h.controller.refresh).not.toHaveBeenCalled(); expect(h.bridge.view.userId).toBe(B);
  });
  it('does not reuse the old A rule task or busy state after a B to A session round trip', async () => {
    const h = setup(), save = deferred<{ updatedAt: string } & ReminderRuleInput>(); h.service.setRule.mockReturnValueOnce(save.promise); await h.render();
    let operation!: Promise<unknown>; await act(async () => { operation = h.bridge.saveRule(input, NOW).catch(error => error); });
    await h.render(h.makeAuth(B)); await h.render(h.makeAuth(A, 'synthetic-new-login')); const busy = h.bridge.savingRule;
    let result: unknown; await act(async () => { save.resolve({ ...input, updatedAt: NOW }); result = await operation; });
    expect(busy).toBe(false); expect(result).toBeInstanceOf(ReminderError); expect(h.controller.refresh).not.toHaveBeenCalled();
  });
  it('bounds an unknown rule write without claiming success or retaining an endless busy form', async () => {
    const h = setup(); h.service.setRule.mockReturnValueOnce(new Promise(() => {})); await h.render(); vi.useFakeTimers();
    let operation!: Promise<unknown>; await act(async () => { operation = h.bridge.saveRule(input, NOW).catch(error => error); });
    expect(h.bridge.savingRule).toBe(true); await act(async () => { await vi.advanceTimersByTimeAsync(10001); });
    expect(await operation).toMatchObject({ kind: 'failed' }); expect(h.bridge.savingRule).toBe(false); expect(h.controller.refresh).not.toHaveBeenCalled();
  });
  it('returns an empty rule only from a confirmed metadata projection, never from a failed read', async () => {
    const h = setup(); await h.render(); await expect(h.bridge.reloadRule(A)).rejects.toMatchObject({ kind: 'failed' });
    h.controller.refresh.mockImplementation(async () => { h.emit({ userId: A, phase: 'ready', snapshot: { capabilities: { enabled: true, publicKey: KEY, lastTick: NOW }, rules: [], devices: [] } }); });
    await act(async () => { expect(await h.bridge.reloadRule(A)).toBeNull(); });
    h.controller.refresh.mockImplementation(async () => { h.emit({ userId: A, phase: 'ready', snapshot: { capabilities: { enabled: true, publicKey: KEY, lastTick: NOW }, rules: [{ ...input, updatedAt: NOW }], devices: [] } }); });
    await act(async () => { expect(await h.bridge.reloadRule(A)).toEqual({ ...input, updatedAt: NOW }); });
  });
  it('refuses pending rule acknowledgement and reload when the same account becomes unconfirmed', async () => {
    const h = setup(), save = deferred<{ updatedAt: string } & ReminderRuleInput>(); h.service.setRule.mockReturnValueOnce(save.promise); await h.render();
    let operation!: Promise<unknown>; await act(async () => { operation = h.bridge.saveRule(input, NOW).catch(error => error); });
    await h.render({ ...h.makeAuth(), initializing: true });
    await act(async () => { save.resolve({ ...input, updatedAt: NOW }); expect(await operation).toMatchObject({ kind: 'session' }); });
    await expect(h.bridge.reloadRule(A)).rejects.toMatchObject({ kind: 'session' });
    expect(h.controller.refresh).not.toHaveBeenCalled();
  });
});
