import { FamilyError } from './familyService';

export function familyFailure(cause: unknown) {
  return cause instanceof FamilyError ? cause.message : '暫時無法完成家庭操作，輸入內容已保留；請檢查連線後再試。';
}
export function familyTime(value: string, timezone: string) {
  return new Intl.DateTimeFormat('zh-TW', { timeZone: timezone, dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
}
