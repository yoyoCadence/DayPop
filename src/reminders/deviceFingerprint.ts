import { isAllowedPushEndpoint } from './pushEndpoint';

export function isReminderDeviceScope(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2048) return false;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && url.href === value && url.pathname.endsWith('/') &&
      !url.username && !url.password && !url.search && !url.hash;
  } catch { return false; }
}
/** Opaque local metadata, insufficient to send a push. Never persist the input capability. */
export async function reminderDeviceFingerprint(scope: string, endpoint: string): Promise<string> {
  if (!isReminderDeviceScope(scope) || !isAllowedPushEndpoint(endpoint)) throw new Error('無法辨識這台裝置的通知資料。');
  const bytes = new TextEncoder().encode('daypop-push-v1\0' + scope + '\0' + endpoint);
  try {
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  } catch { throw new Error('無法辨識這台裝置的通知資料。'); }
}
