import type { ReminderCapabilities, ReminderDeviceInput } from './reminderService';
import { isAllowedPushEndpoint } from './pushEndpoint';
import { reminderDeviceFingerprint } from './deviceFingerprint';

export interface ReminderRegistration {
  readonly scope: string;
  readonly active: Pick<ServiceWorker, 'state' | 'postMessage'> | null;
  readonly pushManager: Pick<PushManager, 'getSubscription' | 'subscribe'>;
}
/** Injected for deterministic tests; native access happens only when constructed. */
export interface ReminderBrowser {
  readonly secure: boolean; readonly supported: boolean; readonly ios: boolean; readonly standalone: boolean;
  readonly origin: string; readonly scope: string;
  permission(): NotificationPermission;
  userActivation(): boolean;
  requestPermission(): Promise<NotificationPermission>;
  registration(): Promise<ReminderRegistration | null>;
  channel(): MessageChannel;
  now(): number;
}
export interface BrowserReminderStatus { permission: NotificationPermission; subscription: 'none' | 'matching' | 'different' }
export class BrowserReminderError extends Error {
  constructor(readonly kind: 'unsupported' | 'install' | 'backend' | 'worker' | 'permission' | 'gesture' | 'subscription' | 'cancelled' | 'cleanup' | 'busy', message: string) {
    super(message); this.name = 'BrowserReminderError';
  }
}
const failure = () => new BrowserReminderError('subscription', '無法確認這台裝置的通知設定，請重新確認後再試。');
const workerFailure = () => new BrowserReminderError('worker', '請先完成 App 更新，再重新確認通知設定。');
const cleanupFailure = () => new BrowserReminderError('cleanup', '裝置通知的停用尚未確認，請保持連線後再試。');
const safe = (cause: unknown) => cause instanceof BrowserReminderError ? cause : failure();
const FRESH_MS = 30_000;
type Prepared = { registration: ReminderRegistration; worker: NonNullable<ReminderRegistration['active']>; key: Uint8Array<ArrayBuffer>;
  publicKey: string; epoch: number; createdAt: number; subscription: BrowserReminderStatus['subscription'] };

function nativeBrowser(): ReminderBrowser {
  const scope = new URL(import.meta.env.BASE_URL, window.location.href).href;
  return {
    secure: window.isSecureContext,
    supported: 'Notification' in window && 'PushManager' in window && 'serviceWorker' in navigator && 'MessageChannel' in window && 'userActivation' in navigator,
    ios: /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1),
    standalone: window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true,
    origin: window.location.origin, scope,
    permission: () => Notification.permission,
    userActivation: () => navigator.userActivation?.isActive === true,
    requestPermission: () => Notification.requestPermission(),
    registration: async () => (await navigator.serviceWorker.getRegistration(scope)) ?? null,
    channel: () => new MessageChannel(), now: () => Date.now(),
  };
}
function decodePublicKey(value: unknown): Uint8Array<ArrayBuffer> {
  if (typeof value !== 'string' || value.length !== 87 || !/^B[A-Za-z0-9_-]{86}$/.test(value)) throw failure();
  const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/') + '=');
  const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
  if (bytes.length !== 65 || bytes[0] !== 4) throw failure();
  return bytes;
}
function sameKey(subscription: PushSubscription, key: Uint8Array<ArrayBuffer>): boolean {
  const stored = subscription.options.applicationServerKey;
  if (!stored) return false;
  const bytes = new Uint8Array(stored);
  return bytes.length === key.length && bytes.every((byte, index) => byte === key[index]);
}
function base64url(buffer: ArrayBuffer | null, size: number): string {
  if (!buffer || buffer.byteLength !== size) throw failure();
  return btoa(String.fromCharCode(...new Uint8Array(buffer))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function capability(subscription: PushSubscription, prepared: Prepared): ReminderDeviceInput {
  if (!isAllowedPushEndpoint(subscription.endpoint) || !sameKey(subscription, prepared.key)) throw failure();
  const encryptionKey = subscription.getKey('p256dh');
  const p256dh = base64url(encryptionKey, 65), auth = base64url(subscription.getKey('auth'), 16);
  if (new Uint8Array(encryptionKey!)[0] !== 4) throw failure();
  return { endpoint: subscription.endpoint, p256dh, auth, publicKey: prepared.publicKey };
}
function probe(worker: NonNullable<ReminderRegistration['active']>, channel: MessageChannel): Promise<boolean> {
  return new Promise(resolve => {
    const finish = (value: boolean) => {
      clearTimeout(timer); channel.port1.close(); channel.port2.close(); resolve(value);
    };
    const timer = setTimeout(() => finish(false), 1500);
    channel.port1.onmessage = event => {
      const value = event.data;
      finish(Boolean(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 2 &&
        value.type === 'REMINDER_CAPABILITIES' && value.v === 1));
    };
    try { worker.postMessage({ type: 'GET_REMINDER_CAPABILITIES', v: 1 }, [channel.port2]); }
    catch { finish(false); }
  });
}

/** Browser-only primitive. No account registration, persistence or automatic consent. */
export class BrowserReminderDevice {
  #epoch = 0;
  #prepared: Prepared | null = null;
  #pending: Promise<ReminderDeviceInput> | null = null;
  constructor(private readonly browser: ReminderBrowser = nativeBrowser()) {}
  invalidate() { this.#epoch++; this.#prepared = null; }
  /** Safe identity for matching a local receipt; does not prompt, register or expose endpoint/keying material. */
  async identity(): Promise<{ fingerprint: string; publicKey: string | null } | null> {
    try {
      if (!this.browser.secure) throw failure();
      const registration = await this.browser.registration();
      if (!registration) return null;
      this.validRegistration(registration);
      const subscription = await registration.pushManager.getSubscription();
      if (!subscription) return null;
      const key = subscription.options.applicationServerKey;
      if (key && new Uint8Array(key)[0] !== 4) throw failure();
      return { fingerprint: await reminderDeviceFingerprint(this.browser.scope, subscription.endpoint), publicKey: key ? base64url(key, 65) : null };
    } catch (cause) { throw safe(cause); }
  }
  private available() {
    if (!this.browser.secure) throw new BrowserReminderError('unsupported', '請使用安全連線開啟日蹦，再設定通知。');
    if (this.browser.ios && !this.browser.standalone) throw new BrowserReminderError('install', '請先將日蹦加入主畫面，並從主畫面開啟後設定通知。');
    if (!this.browser.supported) throw new BrowserReminderError('unsupported', '此瀏覽器尚未支援需要的背景通知功能。');
  }
  private validRegistration(registration: ReminderRegistration | null): asserts registration is ReminderRegistration {
    const expected = new URL(this.browser.scope), actual = registration && new URL(registration.scope);
    if (expected.origin !== this.browser.origin || !expected.pathname.endsWith('/') || expected.search || expected.hash || !actual || actual.href !== expected.href) throw workerFailure();
  }
  private current(prepared: Prepared) {
    if (prepared.epoch !== this.#epoch) throw new BrowserReminderError('cancelled', '通知設定已變更，請重新確認後再試。');
    const elapsed = this.browser.now() - prepared.createdAt;
    if (elapsed < 0 || elapsed > FRESH_MS || prepared.registration.active !== prepared.worker || prepared.worker.state !== 'activated') throw workerFailure();
    this.available();
  }
  async prepare(capabilities: Pick<ReminderCapabilities, 'enabled' | 'publicKey'>): Promise<BrowserReminderStatus> {
    try {
      if (this.#pending) throw new BrowserReminderError('busy', '通知設定仍在處理中，請稍後再試。');
      this.invalidate(); const epoch = this.#epoch, createdAt = this.browser.now();
      this.available();
      if (capabilities.enabled !== true) throw new BrowserReminderError('backend', '背景提醒尚未啟用，請稍後再試。');
      const key = decodePublicKey(capabilities.publicKey), registration = await this.browser.registration();
      this.validRegistration(registration);
      const worker = registration.active;
      if (!worker || worker.state !== 'activated' || !await probe(worker, this.browser.channel())) throw workerFailure();
      const subscription = await registration.pushManager.getSubscription();
      const status = { permission: this.browser.permission(), subscription: subscription ? sameKey(subscription, key) ? 'matching' as const : 'different' as const : 'none' as const };
      const prepared = { registration, worker, key, publicKey: capabilities.publicKey!, epoch, createdAt, subscription: status.subscription };
      this.current(prepared); this.#prepared = prepared;
      return status;
    } catch (cause) { throw safe(cause); }
  }
  /** Called directly by a trusted click after prepare; permission is invoked before any await. */
  subscribe(): Promise<ReminderDeviceInput> {
    try {
      const prepared = this.#prepared;
      if (!prepared) throw workerFailure();
      this.current(prepared);
      if (!this.browser.userActivation()) throw new BrowserReminderError('gesture', '請點按開啟通知，完成這台裝置的確認。');
      if (prepared.subscription === 'different') throw new BrowserReminderError('subscription', '裝置通知的金鑰已變更，請先完成停用再重新設定。');
      const permission = this.browser.permission();
      if (permission === 'denied') throw new BrowserReminderError('permission', '通知權限已被拒絕，請先在系統設定調整。');
      this.#prepared = null; // One prepared action cannot open concurrent permission prompts.
      const requested = permission === 'granted' ? Promise.resolve(permission) : this.browser.requestPermission();
      const pending = this.finishSubscribe(prepared, requested); this.#pending = pending;
      const clear = () => { if (this.#pending === pending) this.#pending = null; };
      void pending.then(clear, clear);
      return pending;
    } catch (cause) { return Promise.reject(safe(cause)); }
  }
  private async finishSubscribe(prepared: Prepared, permission: Promise<NotificationPermission>): Promise<ReminderDeviceInput> {
    try {
      if (await permission !== 'granted') throw new BrowserReminderError('permission', '尚未允許通知，這台裝置沒有開啟提醒。');
      this.current(prepared);
      const manager = prepared.registration.pushManager, existing = await manager.getSubscription();
      this.current(prepared);
      if (existing) return capability(existing, prepared); // Never rotate or remove an existing subscription implicitly.
      const created = await manager.subscribe({ userVisibleOnly: true, applicationServerKey: prepared.key });
      try { this.current(prepared); return capability(created, prepared); }
      catch (cause) { await this.remove(created, manager); throw cause; }
    } catch (cause) { throw safe(cause); }
  }
  private async remove(subscription: PushSubscription, manager: ReminderRegistration['pushManager']) {
    try { await subscription.unsubscribe(); } catch { /* A reread, not the boolean, confirms local absence. */ }
    try { if (await manager.getSubscription() !== null) throw cleanupFailure(); }
    catch { throw cleanupFailure(); }
  }
  async unsubscribe(): Promise<void> {
    this.invalidate();
    try {
      // A late-created subscription must finish its cancellation cleanup before claiming absence.
      if (this.#pending) await this.#pending.catch(() => {});
      if (!this.browser.secure) throw cleanupFailure();
      const registration = await this.browser.registration();
      if (!registration) return;
      this.validRegistration(registration);
      const existing = await registration.pushManager.getSubscription();
      if (existing) await this.remove(existing, registration.pushManager);
    } catch { throw cleanupFailure(); }
  }
}
