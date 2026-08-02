import { describe, expect, it } from 'vitest';
import { parseQuickAdd, unsupportedQuickAddParts } from './quickAdd';

// A Thursday, so weekday jumps are easy to reason about.
const NOW = new Date(2026, 7, 6, 15, 30);

describe('parseQuickAdd', () => {
  it('returns null for empty input', () => {
    expect(parseQuickAdd('   ', NOW)).toBeNull();
  });

  it('parses the placeholder example from the原檔', () => {
    const draft = parseQuickAdd('明天下午3點 開會 @會議室A 提前15分', NOW);
    expect(draft).toMatchObject({
      title: '開會',
      date: '2026-08-07',
      allDay: false,
      start: '15:00',
      end: '16:00',
      location: '會議室A',
      reminderMinutes: 15,
      repeat: 'none',
    });
  });

  it('defaults to today, all-day and 09:00 when no time is given', () => {
    expect(parseQuickAdd('買菜', NOW)).toMatchObject({
      title: '買菜',
      date: '2026-08-06',
      allDay: true,
      start: '09:00',
      end: '10:00',
    });
  });

  it('handles 上午／下午／中午', () => {
    expect(parseQuickAdd('上午9點 晨會', NOW)?.start).toBe('09:00');
    expect(parseQuickAdd('晚上8點30 看電影', NOW)?.start).toBe('20:30');
    expect(parseQuickAdd('中午 吃飯', NOW)?.start).toBe('12:00');
    expect(parseQuickAdd('上午12點 跨日', NOW)?.start).toBe('00:00');
  });

  it('jumps forward a whole week when naming today’s weekday', () => {
    // NOW is a Thursday (週四).
    expect(parseQuickAdd('週四 回診', NOW)?.date).toBe('2026-08-13');
    expect(parseQuickAdd('週五 回診', NOW)?.date).toBe('2026-08-07');
  });

  it('parses relative days', () => {
    expect(parseQuickAdd('今天 交報告', NOW)?.date).toBe('2026-08-06');
    expect(parseQuickAdd('後天 出差', NOW)?.date).toBe('2026-08-08');
    expect(parseQuickAdd('大後天 出差', NOW)?.date).toBe('2026-08-09');
  });

  it('parses repeat words and hour-based reminders', () => {
    expect(parseQuickAdd('每週 週報', NOW)?.repeat).toBe('weekly');
    expect(parseQuickAdd('工作日 站立會議', NOW)?.repeat).toBe('weekday');
    expect(parseQuickAdd('提前2小時 提醒我 出門', NOW)?.reminderMinutes).toBe(120);
  });

  it('wraps the end time past midnight', () => {
    expect(parseQuickAdd('23點30 夜跑', NOW)).toMatchObject({ start: '23:30', end: '00:30' });
  });

  it('leaves only the title behind', () => {
    expect(parseQuickAdd('每天 早上7點 在公園 跑步 提前10分', NOW)?.title).toBe('跑步');
  });
});

describe('unsupportedQuickAddParts', () => {
  it('names the fragments today’s data model cannot store', () => {
    const draft = parseQuickAdd('每週 下午3點 開會 @會議室A 提前15分', NOW)!;
    expect(unsupportedQuickAddParts(draft)).toEqual(['重複', '地點', '提醒']);
  });

  it('is empty when nothing extra was recognised', () => {
    const draft = parseQuickAdd('下午3點 開會', NOW)!;
    expect(unsupportedQuickAddParts(draft)).toEqual([]);
  });
});
