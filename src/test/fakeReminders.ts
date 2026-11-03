import { BrowserReminderError } from '../reminders/browserPush';
import { ReminderDeviceController } from '../reminders/deviceController';
import { ReminderDeviceRecords } from '../reminders/deviceRecords';
import { reminderDeviceFingerprint } from '../reminders/deviceFingerprint';
import { ReminderError, type ReminderCapabilities, type ReminderDevice, type ReminderDeviceInput, type ReminderRule, type ReminderRuleInput, type ReminderService } from '../reminders/reminderService';

const KEY = 'B' + 'A'.repeat(86), NOW = '2026-11-02T01:00:00.000Z';
const INPUT: ReminderDeviceInput = { endpoint: 'https://fcm.googleapis.com/fcm/send/daypop-e2e-synthetic-no-network', p256dh: KEY, auth: 'A'.repeat(22), publicKey: KEY };
/** Dev-only UI seam. No network, real permission prompt, actual subscription or RLS claims. */
export class FakeReminderHarness {
  capabilities: ReminderCapabilities = { enabled: true, publicKey: KEY, lastTick: NOW };
  permission: NotificationPermission = 'default';
  installRequired = false; workerReady = true; backendUnavailable = false;
  failLocalRemoval = false; failServerRemoval = false; failRuleWrites = false;
  loseNextRegistrationResponse = false; loseNextRuleResponse = false; holdRegistration = false;
  readonly stats = { loads: 0, preflights: 0, consents: 0, registrations: 0, serverRemovals: 0, localRemovals: 0, ruleWrites: 0, activation: [] as boolean[] };
  readonly rules = new Map<string, Map<string, ReminderRule>>();
  readonly devices = new Map<string, Map<string, ReminderDevice>>();
  #native: { fingerprint: string; publicKey: string } | null = null;
  #prepared = false;
  #clock = Date.parse(NOW);
  #releases: Array<() => void> = [];
  private ownRules(userId: string) {
    let rows = this.rules.get(userId); if (!rows) { rows = new Map(); this.rules.set(userId, rows); } return rows;
  }
  private ownDevices(userId: string) {
    let rows = this.devices.get(userId); if (!rows) { rows = new Map(); this.devices.set(userId, rows); } return rows;
  }
  private async remove(userId: string, deviceId: string) {
    this.stats.serverRemovals++;
    if (this.failServerRemoval) throw new ReminderError('cleanup', '伺服器裝置的停用尚未確認，請保持連線後再試。', deviceId);
    this.ownDevices(userId).delete(deviceId);
  }
  releaseRegistrations() { this.holdRegistration = false; for (const release of this.#releases.splice(0)) release(); }
  dropNativeSubscription() { this.#native = null; }
  deleteServerDevices(userId: string) { this.ownDevices(userId).clear(); }
  changeRuleElsewhere(userId: string, calendarId: string, minutes: number[]) {
    const rows = this.ownRules(userId), current = rows.get(calendarId);
    if (!current) throw new Error('Seed a saved synthetic rule first');
    rows.set(calendarId, { ...current, minutesBefore: [...minutes], updatedAt: new Date(++this.#clock).toISOString() });
  }
  serviceForUser = (userId: string): ReminderService => {
    const registerDeviceLease = async () => {
      this.stats.registrations++;
      const deviceId = '10000000-0000-4000-8000-' + userId.slice(-12), rows = this.ownDevices(userId);
      if (!rows.has(deviceId)) rows.set(deviceId, { id: deviceId, createdAt: NOW, updatedAt: NOW });
      const lease = { id: deviceId, remove: () => this.remove(userId, deviceId) };
      if (this.holdRegistration) await new Promise<void>(resolve => { this.#releases.push(resolve); });
      if (this.loseNextRegistrationResponse) { this.loseNextRegistrationResponse = false; throw new ReminderError('failed', '尚無法確認註冊結果，請重新確認。'); }
      return lease;
    };
    return {
      capabilities: async () => structuredClone(this.capabilities),
      load: async () => {
        this.stats.loads++;
        if (this.backendUnavailable) throw new ReminderError('unavailable', '背景提醒尚未啟用，請稍後再試。');
        return structuredClone({ capabilities: this.capabilities, rules: [...this.ownRules(userId).values()], devices: [...this.ownDevices(userId).values()] });
      },
      setRule: async (input: ReminderRuleInput, expected: string | null) => {
        this.stats.ruleWrites++;
        if (this.failRuleWrites) throw new ReminderError('failed', '尚無法確認設定是否已保存，請重新確認。');
        const rows = this.ownRules(userId), current = rows.get(input.calendarId);
        if ((current?.updatedAt ?? null) !== expected) throw new ReminderError('conflict', '提醒設定已變更，請重新確認後再試。');
        let saved: ReminderRule | null = null;
        if (!input.minutesBefore.length) rows.delete(input.calendarId);
        else { saved = { ...input, minutesBefore: [...input.minutesBefore], updatedAt: new Date(++this.#clock).toISOString() }; rows.set(input.calendarId, saved); }
        if (this.loseNextRuleResponse) { this.loseNextRuleResponse = false; throw new ReminderError('failed', '尚無法確認設定是否已保存，請重新確認。'); }
        return structuredClone(saved);
      },
      registerDevice: async () => (await registerDeviceLease()).id, registerDeviceLease,
      unregisterDevice: deviceId => this.remove(userId, deviceId),
      captureDeviceRemoval: async deviceId => () => this.remove(userId, deviceId),
    };
  };
  createController = () => {
    const scope = new URL(import.meta.env.BASE_URL, window.location.href).href;
    return new ReminderDeviceController(scope, {
      invalidate: () => { this.#prepared = false; }, identity: async () => this.#native,
      prepare: async () => {
        this.stats.preflights++;
        if (this.installRequired) throw new BrowserReminderError('install', '請先將日蹦加入主畫面，並從主畫面開啟後設定通知。');
        if (!this.workerReady) throw new BrowserReminderError('worker', '請先完成 App 更新，再重新確認通知設定。');
        this.#prepared = true; return { permission: this.permission, subscription: this.#native ? 'matching' : 'none' };
      },
      subscribe: async () => {
        const activation = navigator.userActivation.isActive; this.stats.activation.push(activation);
        if (!this.#prepared || !activation) throw new BrowserReminderError('gesture', '請點按開啟通知，完成這台裝置的確認。');
        this.#prepared = false;
        if (this.permission === 'denied') throw new BrowserReminderError('permission', '通知權限已被拒絕，請先在系統設定調整。');
        this.stats.consents++; this.permission = 'granted';
        this.#native = { fingerprint: await reminderDeviceFingerprint(scope, INPUT.endpoint), publicKey: KEY }; return INPUT;
      },
      unsubscribe: async () => {
        this.stats.localRemovals++;
        if (this.failLocalRemoval) throw new BrowserReminderError('cleanup', '裝置通知的停用尚未確認，請保持連線後再試。');
        this.#native = null;
      },
    }, new ReminderDeviceRecords(scope));
  };
}
