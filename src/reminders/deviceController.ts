import { BrowserReminderError, type BrowserReminderDevice } from './browserPush';
import { DeviceRecordsError, type ReminderDeviceRecord, type ReminderDeviceRecords } from './deviceRecords';
import { reminderDeviceFingerprint } from './deviceFingerprint';
import { ReminderError, type RegisteredReminderDevice, type ReminderDeviceInput, type ReminderService, type ReminderSnapshot } from './reminderService';

export type ReminderIdentity = { kind: 'waiting' } | { kind: 'guest' } | { kind: 'account'; userId: string; service: ReminderService };
type Account = Extract<ReminderIdentity, { kind: 'account' }>;
type BrowserPort = Pick<BrowserReminderDevice, 'prepare' | 'subscribe' | 'unsubscribe' | 'identity' | 'invalidate'>;
export interface ReminderDeviceView {
  userId: string | null;
  phase: 'waiting' | 'guest' | 'loading' | 'ready' | 'active' | 'busy' | 'unavailable' | 'unconfirmed';
  canEnable: boolean; deviceId: string | null; pendingCount: number; error: string | null;
  snapshot: ReminderSnapshot | null;
}
type Ticket = { epoch: number; account: Account; cancelled: boolean };
const GENERIC = '無法確認裝置通知狀態，請保持連線後重新確認。';
const PENDING = '裝置通知仍有待確認的操作，尚不能宣稱已啟用或停用。';
const TIMEOUT = '裝置通知操作尚未確認，請保持連線後再試。';
const message = (cause: unknown) => cause instanceof ReminderError || cause instanceof BrowserReminderError || cause instanceof DeviceRecordsError ? cause.message : GENERIC;
async function bounded<T>(promise: Promise<T>, ms = 5000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([promise, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error(TIMEOUT)), ms); })]); }
  finally { clearTimeout(timer); }
}

/** Session coordinator only. State contains safe projections; native capability data stays transient. */
export class ReminderDeviceController {
  #identity: ReminderIdentity = { kind: 'waiting' };
  #lastAccount: Account | null = null;
  #epoch = 0;
  #closed = false;
  #prepared: { epoch: number; account: Account; retry: ReminderDeviceRecord | null } | null = null;
  #enableTask: Promise<boolean> | null = null;
  #stopTask: Promise<boolean> | null = null;
  #registrations = new Set<Promise<RegisteredReminderDevice>>();
  #localStops = new Set<Promise<void>>();
  #removers = new Map<string, () => Promise<void>>();
  #listeners = new Set<() => void>();
  #view: ReminderDeviceView = { userId: null, phase: 'waiting', canEnable: false, deviceId: null, pendingCount: 0, error: null, snapshot: null };
  constructor(private readonly scope: string, private readonly browser: BrowserPort, private readonly records: ReminderDeviceRecords) {
    if (records.scope !== scope) throw new DeviceRecordsError('invalid');
  }
  getSnapshot = () => this.#view;
  subscribe = (listener: () => void) => { this.#listeners.add(listener); return () => { this.#listeners.delete(listener); }; };
  private countPending() {
    const state = this.records.read(), userId = this.#identity.kind === 'account' ? this.#identity.userId : null;
    return Math.max(state.records.filter(row => row.phase !== 'active' || row.userId !== userId).length, state.status === 'ready' ? 0 : 1);
  }
  private publish(patch: Partial<ReminderDeviceView>) {
    if (this.#closed) return;
    this.#view = { ...this.#view, ...patch, pendingCount: this.countPending() };
    for (const listener of this.#listeners) listener();
  }
  private current(ticket: Ticket) {
    return !this.#closed && !ticket.cancelled && ticket.epoch === this.#epoch && this.#identity.kind === 'account' && this.#identity.userId === ticket.account.userId;
  }
  private requireCurrent(ticket: Ticket) { if (!this.current(ticket)) throw new Error(GENERIC); }
  private latest(record: ReminderDeviceRecord) {
    const state = this.records.read();
    if (state.status !== 'ready') throw new DeviceRecordsError(state.status);
    const latest = state.records.find(row => row.operationId === record.operationId && row.userId === record.userId);
    if (!latest) throw new DeviceRecordsError('conflict');
    return latest;
  }
  private mark(record: ReminderDeviceRecord, patch: Parameters<ReminderDeviceRecords['update']>[1]) {
    return this.records.update(this.latest(record), patch);
  }
  private forget(record: ReminderDeviceRecord) { this.records.remove(this.latest(record)); }
  private remember(account: Account, lease: RegisteredReminderDevice) { this.#removers.set(account.userId + ':' + lease.id, lease.remove); }
  private refreshLater() {
    if (!this.#closed && !this.#enableTask && !this.#stopTask && !this.#registrations.size && !this.#localStops.size) void this.refresh();
  }
  private unsubscribe() {
    const operation = this.browser.unsubscribe();
    this.#localStops.add(operation);
    const finish = () => { this.#localStops.delete(operation); };
    void operation.then(finish, finish);
    return operation;
  }
  async setIdentity(identity: ReminderIdentity): Promise<void> {
    const previous = this.#identity, previousAccount = this.#lastAccount;
    const sameAccount = identity.kind === 'account' && previous.kind === 'account' && identity.userId === previous.userId;
    this.#identity = identity;
    if (identity.kind === 'account') this.#lastAccount = identity;
    else if (identity.kind === 'guest') this.#lastAccount = null;
    if (sameAccount) { if (!this.#enableTask && !this.#stopTask) await this.refresh(); return; }
    const epoch = ++this.#epoch; this.#prepared = null; this.browser.invalidate();
    this.publish({ userId: identity.kind === 'account' ? identity.userId : null, phase: identity.kind === 'account' ? 'loading' : identity.kind, canEnable: false, deviceId: null, snapshot: null, error: null });
    // Waiting/unconfirmed startup is not a sign-out. Closing the App must retain active notifications.
    if (identity.kind === 'waiting') return;
    let stopped = true;
    if (previousAccount && (identity.kind !== 'account' || previousAccount.userId !== identity.userId)) stopped = await this.stop(previousAccount);
    else if (identity.kind === 'guest') stopped = await this.stop(null);
    if (epoch !== this.#epoch || this.#closed) return;
    await this.refresh();
    if (!stopped && this.#identity === identity) this.publish({ phase: 'unconfirmed', canEnable: false, error: PENDING });
  }
  async refresh(): Promise<void> {
    const identity = this.#identity;
    if (identity.kind !== 'account') {
      this.publish({ phase: this.countPending() ? 'unconfirmed' : identity.kind, canEnable: false, snapshot: null, error: this.countPending() ? PENDING : null }); return;
    }
    if (this.#enableTask || this.#stopTask) { this.publish({ phase: 'busy', canEnable: false }); return; }
    if (this.#registrations.size || this.#localStops.size) { this.publish({ phase: 'unconfirmed', canEnable: false, error: PENDING }); return; }
    const epoch = ++this.#epoch;
    this.browser.invalidate();
    this.#prepared = null;
    try {
      let state = this.records.read();
      if (state.status !== 'ready') throw new DeviceRecordsError(state.status);
      const [snapshot, native] = await bounded(Promise.all([identity.service.load(), this.browser.identity()]));
      if (epoch !== this.#epoch || this.#closed) return;
      state = this.records.read();
      if (state.status !== 'ready') throw new DeviceRecordsError(state.status);
      const own = state.records.filter(row => row.userId === identity.userId);
      for (const row of own) if (row.deviceId) {
        const remove = await bounded(identity.service.captureDeviceRemoval(row.deviceId));
        if (epoch !== this.#epoch || this.#closed) return;
        this.#removers.set(identity.userId + ':' + row.deviceId, remove);
      }
      const active = own.find(row => row.phase === 'active' && row.deviceId && native && row.fingerprint === native.fingerprint &&
        row.publicKey === native.publicKey && snapshot.devices.some(device => device.id === row.deviceId));
      if (active) {
        this.publish({ phase: snapshot.capabilities.enabled && snapshot.capabilities.publicKey === active.publicKey ? 'active' : 'unavailable',
          snapshot, deviceId: active.deviceId, canEnable: false, error: snapshot.capabilities.enabled && snapshot.capabilities.publicKey === active.publicKey ? null : '背景提醒服務或裝置金鑰需要重新確認。' }); return;
      }
      const retry = own.find(row => row.phase === 'unconfirmed' && row.deviceId === null && native && row.fingerprint === native.fingerprint && row.publicKey === native.publicKey) ?? null;
      if ((own.length && !retry) || (native && !retry)) {
        // An unowned native subscription must never be silently transferred to the current account.
        if (native && !own.some(row => row.fingerprint === native.fingerprint)) await bounded(this.unsubscribe());
        if (epoch === this.#epoch) this.publish({ phase: 'unconfirmed', canEnable: false, deviceId: null, snapshot, error: PENDING });
        return;
      }
      if (!snapshot.capabilities.enabled) { this.publish({ phase: 'unavailable', canEnable: false, snapshot, deviceId: null, error: '背景提醒尚未啟用，請稍後再試。' }); return; }
      const prepared = await this.browser.prepare(snapshot.capabilities);
      if (epoch !== this.#epoch || this.#closed) return;
      const allowed = prepared.permission !== 'denied' && prepared.subscription !== 'different';
      this.#prepared = allowed ? { epoch, account: identity, retry } : null;
      this.publish({ phase: retry ? 'unconfirmed' : 'ready', snapshot, deviceId: null, canEnable: allowed,
        error: prepared.permission === 'denied' ? '通知權限已被拒絕，請先在系統設定調整。' : prepared.subscription === 'different' ? PENDING : retry ? PENDING : null });
    } catch (cause) {
      if (epoch === this.#epoch) this.publish({ phase: 'unconfirmed', canEnable: false, snapshot: null, error: message(cause) });
    }
  }
  /** Called directly by a trusted action; no network or await precedes browser.subscribe(). */
  enable(): Promise<boolean> {
    const prepared = this.#prepared;
    if (!prepared || prepared.epoch !== this.#epoch || !this.#view.canEnable || this.#enableTask || this.#registrations.size || this.#localStops.size) return Promise.resolve(false);
    this.#prepared = null;
    const ticket: Ticket = { epoch: this.#epoch, account: prepared.account, cancelled: false };
    let record: ReminderDeviceRecord;
    try {
      this.requireCurrent(ticket);
      record = prepared.retry ? this.mark(prepared.retry, { phase: 'registering' }) : this.records.create(ticket.account.userId, this.#view.snapshot!.capabilities.publicKey!);
      this.publish({ phase: 'busy', canEnable: false, error: null });
      let native: Promise<ReminderDeviceInput>;
      try { native = this.browser.subscribe(); } catch (cause) { native = Promise.reject(cause); }
      const task = this.finishEnable(ticket, record, native, Boolean(prepared.retry)); this.#enableTask = task;
      void task.then(() => { if (this.#enableTask === task) this.#enableTask = null; this.refreshLater(); });
      return task;
    } catch (cause) { this.publish({ phase: 'unconfirmed', canEnable: false, error: message(cause) }); return Promise.resolve(false); }
  }
  private async cleanupLease(ticket: Ticket, record: ReminderDeviceRecord, lease: RegisteredReminderDevice): Promise<void> {
    this.remember(ticket.account, lease);
    try {
      this.mark(record, { phase: 'unconfirmed', deviceId: lease.id });
    } catch { /* An existing pre-registration marker still records uncertainty if persistence fails. */ }
    await bounded(Promise.all([lease.remove(), this.unsubscribe()]));
    this.forget(record); this.#removers.delete(ticket.account.userId + ':' + lease.id);
  }
  private async finishEnable(ticket: Ticket, initial: ReminderDeviceRecord, native: Promise<ReminderDeviceInput>, retry: boolean): Promise<boolean> {
    let record = initial, cloudStarted = false, lease: RegisteredReminderDevice | null = null;
    try {
      const input = await native; this.requireCurrent(ticket);
      const fingerprint = await reminderDeviceFingerprint(this.scope, input.endpoint); this.requireCurrent(ticket);
      record = this.mark(record, { fingerprint }); this.requireCurrent(ticket); cloudStarted = true;
      const registration = ticket.account.service.registerDeviceLease(input).then(async result => {
        if (!this.current(ticket)) { await this.cleanupLease(ticket, record, result); throw new Error(GENERIC); }
        return result;
      });
      this.#registrations.add(registration);
      void registration.then(() => { this.#registrations.delete(registration); this.refreshLater(); }, () => { this.#registrations.delete(registration); this.refreshLater(); });
      try { lease = await bounded(registration, 8000); }
      catch (cause) { if (this.#registrations.has(registration)) ticket.cancelled = true; throw cause; }
      this.remember(ticket.account, lease); this.requireCurrent(ticket);
      record = this.mark(record, { deviceId: lease.id, phase: 'active' }); this.requireCurrent(ticket);
      this.publish({ phase: 'active', deviceId: lease.id, canEnable: false, error: null }); return true;
    } catch (cause) {
      if (lease) { try { await this.cleanupLease(ticket, record, lease); } catch { /* Receipt/marker stays for reconciliation. */ } }
      else if (cause instanceof ReminderError && cause.removedDeviceId) {
        try { await bounded(this.unsubscribe()); this.forget(record); } catch { /* Keep the marker. */ }
      } else if (!cloudStarted && !retry) {
        try { await bounded(this.unsubscribe()); this.forget(record); } catch { try { this.mark(record, { phase: 'unconfirmed' }); } catch { /* Preserve old bytes. */ } }
      } else {
        try { this.mark(record, { phase: 'unconfirmed', ...(cause instanceof ReminderError && cause.pendingDeviceId ? { deviceId: cause.pendingDeviceId } : {}) }); } catch { /* Preserve old bytes. */ }
        if (!this.current(ticket)) { try { await bounded(this.unsubscribe()); } catch { /* Unconfirmed remains explicit. */ } }
      }
      if (this.current(ticket)) this.publish({ phase: 'unconfirmed', canEnable: false, error: message(cause) });
      return false;
    }
  }
  private async stop(account: Account | null): Promise<boolean> {
    if (this.#stopTask) { await this.#stopTask; return this.stop(account); }
    const run = async () => {
      const state = this.records.read(), own = state.records.filter(row => account === null || row.userId === account.userId);
      let confirmed = state.status === 'ready' && !this.#registrations.size;
      const results = await bounded(Promise.allSettled([this.unsubscribe(), ...own.map(async row => {
        if (!row.deviceId) throw new Error(PENDING);
        let remove = this.#removers.get(row.userId + ':' + row.deviceId);
        if (!remove && account && row.userId === account.userId) remove = await account.service.captureDeviceRemoval(row.deviceId);
        if (!remove) throw new Error(PENDING);
        await remove();
      })])).catch(() => null);
      if (!results || results.some(result => result.status === 'rejected')) confirmed = false;
      if (confirmed) {
        for (const row of own) { try { this.forget(row); } catch { confirmed = false; } }
      } else {
        // An explicitly requested stop may confirm unknown-id markers only when the account has no devices at all.
        if (account && results?.[0]?.status === 'fulfilled' && !this.#registrations.size) {
          try {
            const snapshot = await bounded(account.service.load());
            if (snapshot.devices.length === 0 && state.status === 'ready') {
              for (const row of own) this.forget(row);
              confirmed = true;
            }
          } catch { /* No empty default on failed metadata reads. */ }
        }
        if (!confirmed) for (const row of own) { try { this.mark(row, { phase: 'unconfirmed' }); } catch { /* Preserve future/corrupt/failed persistence. */ } }
      }
      return confirmed;
    };
    const task = run().catch(() => false); this.#stopTask = task;
    void task.then(() => { if (this.#stopTask === task) this.#stopTask = null; });
    return task;
  }
  async disable(): Promise<boolean> {
    this.#epoch++; this.#prepared = null; this.browser.invalidate(); this.publish({ phase: 'busy', canEnable: false });
    const confirmed = await this.stop(this.#identity.kind === 'account' ? this.#identity : null);
    this.publish({ phase: confirmed ? this.#identity.kind === 'account' ? 'ready' : this.#identity.kind : 'unconfirmed', deviceId: null, canEnable: false, error: confirmed ? null : PENDING });
    if (confirmed) await this.refresh(); return confirmed;
  }
  invalidatePreflight() {
    if (this.#enableTask || this.#registrations.size) return; // A system prompt/backgrounding is not a sign-out.
    this.#epoch++; this.#prepared = null; this.browser.invalidate(); this.publish({ canEnable: false });
  }
  /** Dispose observers only. Existing active subscriptions must keep working with the App closed. */
  dispose() { this.#closed = true; this.#listeners.clear(); this.#prepared = null; }
}
