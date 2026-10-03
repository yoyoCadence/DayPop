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

  it.each([
    ['下午三點', '15:00'], ['下午十點', '22:00'], ['上午十二點', '00:00'],
    ['中午十二點', '12:00'], ['兩點', '02:00'], ['下午两点', '14:00'],
    ['二十三時五十九分', '23:59'], ['零點零五分', '00:05'], ['〇點', '00:00'],
    ['三點半', '03:30'], ['下午3點半', '15:30'], ['三時一刻', '03:15'],
    ['晚上八点三刻', '20:45'], ['三點十五分', '03:15'], ['三點十五', '03:15'],
    ['三點 三十分', '03:30'], ['３點', '03:00'], ['下午３：０５', '15:05'],
    ['十五：三十', '15:30'], ['3點２５分鐘', '03:25'], ['三點二十五分钟', '03:25'],
  ])('recognises a complete clock %s as %s (DP-075)', (clock, start) => {
    expect(parseQuickAdd(`明天${clock} 開會`, NOW)).toMatchObject({
      title: '開會', date: '2026-08-07', allDay: false, start,
    });
  });

  it('keeps recurrence/location/reminder extraction and title numerals intact', () => {
    expect(parseQuickAdd('每週 明天下午三點半 第３次 一二三研討 @３０１教室 提前15分', NOW))
      .toMatchObject({
        title: '第３次 一二三研討', start: '15:30', end: '16:30',
        location: '３０１教室', reminderMinutes: 15, repeat: 'weekly',
      });
  });

  it.each(['三點', '3點', '三點半'])('preserves a separate numeric title after %s', (clock) => {
    expect(parseQuickAdd(`${clock} 三個願望`, NOW)).toMatchObject({
      title: '三個願望', allDay: false, start: clock.endsWith('半') ? '03:30' : '03:00',
    });
  });

  it('reads attached Chinese minutes and preserves the remaining title', () => {
    expect(parseQuickAdd('下午三點十五開會', NOW)).toMatchObject({ title: '開會', start: '15:15' });
    expect(parseQuickAdd('下午三點十五分開會', NOW)).toMatchObject({ title: '開會', start: '15:15' });
  });

  it.each([
    '下午二十四點', '下午25點', '下午１２３點', '下午一百三點', '下午壹點',
    '三點六十分', '3:60', '3:100', '三點一百五分', '三點廿分', '中午廿點',
    '3:', '3:半', '三點兩刻', '三點 兩刻', '差十分三點', '下午三點差十分', '差一刻下午三點',
  ])('keeps an invalid/unsupported clock visible: %s', (clock) => {
    expect(parseQuickAdd(`${clock} 開會`, NOW)).toMatchObject({
      title: `${clock} 開會`, allDay: true, start: '09:00', end: '10:00',
    });
  });

  it('wraps a Chinese late-night time and permits a time-only draft', () => {
    expect(parseQuickAdd('明天二十三點半', NOW)).toMatchObject({
      title: '', date: '2026-08-07', allDay: false, start: '23:30', end: '00:30',
    });
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
