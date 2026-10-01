// Hand-written iCalendar bytes and expectations. Do not use the production
// serializer/parser to generate either side of these browser assertions.
const exportedDetails = [
  'LOCATION:會議室 A',
  'DESCRIPTION:第一行\\n第二行，保留中文與換行',
  'CLASS:PRIVATE',
];

export const expectedExportComponents = [
  [
    'UID:91000000-0000-4000-8000-000000000003@daypop.local',
    'DTSTAMP:20260929T010000Z',
    'DTSTART;TZID=Asia/Taipei:20260930T090000',
    'DTEND;TZID=Asia/Taipei:20260930T100000',
    'SUMMARY:備份晨會',
    ...exportedDetails,
    'RRULE:FREQ=DAILY;COUNT=3',
    'EXDATE;TZID=Asia/Taipei:20261001T090000',
  ],
  [
    // A replacement shares its series UID, with its original occurrence key.
    'UID:91000000-0000-4000-8000-000000000003@daypop.local',
    'DTSTAMP:20260929T010000Z',
    'RECURRENCE-ID;TZID=Asia/Taipei:20261002T090000',
    'DTSTART;TZID=Asia/Taipei:20261002T110000',
    'DTEND;TZID=Asia/Taipei:20261002T120000',
    'SUMMARY:備份改期晨會',
    ...exportedDetails,
  ],
  [
    'UID:91000000-0000-4000-8000-000000000005@daypop.local',
    'DTSTAMP:20260929T010000Z',
    'DTSTART;TZID=Asia/Taipei:20260930T233000',
    'DTEND;TZID=Asia/Taipei:20261001T010000',
    'SUMMARY:備份夜班',
    ...exportedDetails,
  ],
  [
    'UID:91000000-0000-4000-8000-000000000006@daypop.local',
    'DTSTAMP:20260929T010000Z',
    'DTSTART;VALUE=DATE:20260930',
    // iCalendar ends are exclusive; the canonical end date is October 2.
    'DTEND;VALUE=DATE:20261003',
    'SUMMARY:備份假期',
    ...exportedDetails,
  ],
];

export const externalIcs = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//DayPop Browser Fixture//ZH-TW',
  'BEGIN:VEVENT',
  'UID:floating@example.test',
  'DTSTAMP:20260929T000000Z',
  'DTSTART:20260930T130000',
  'DTEND:20260930T140000',
  'SUMMARY:外部\\,浮動會議',
  'LOCATION:北區\\,會議室\\;A',
  'DESCRIPTION:第一行\\n第二行\\;保留',
  ' 換行與中文',
  'CLASS:PRIVATE',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:new-york@example.test',
  'DTSTAMP:20260929T000000Z',
  'DTSTART;TZID=America/New_York:20260930T230000',
  'DTEND;TZID=America/New_York:20261001T010000',
  'SUMMARY:外部紐約夜班',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:utc@example.test',
  'DTSTAMP:20260929T000000Z',
  'DTSTART:20260930T143000Z',
  'DTEND:20260930T153000Z',
  'SUMMARY:外部 UTC 會議',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:holiday@example.test',
  'DTSTAMP:20260929T000000Z',
  'DTSTART;VALUE=DATE:20260930',
  'DTEND;VALUE=DATE:20261003',
  'SUMMARY:外部連假',
  'END:VEVENT',
  'END:VCALENDAR',
  '',
].join('\r\n');

export const expectedExternalEvents = [
  {
    title: '外部,浮動會議', allDay: false,
    startsAt: '2026-09-30T05:00:00.000Z', endsAt: '2026-09-30T06:00:00.000Z',
    timezone: 'Asia/Taipei', location: '北區,會議室;A',
    notes: '第一行\n第二行;保留換行與中文', sharingScope: 'private',
  },
  {
    title: '外部紐約夜班', allDay: false,
    startsAt: '2026-10-01T03:00:00.000Z', endsAt: '2026-10-01T05:00:00.000Z',
    timezone: 'America/New_York', location: null, notes: null, sharingScope: 'inherit',
  },
  {
    title: '外部 UTC 會議', allDay: false,
    startsAt: '2026-09-30T14:30:00.000Z', endsAt: '2026-09-30T15:30:00.000Z',
    timezone: 'UTC', location: null, notes: null, sharingScope: 'inherit',
  },
  {
    title: '外部連假', allDay: true, startDate: '2026-09-30', endDate: '2026-10-02',
    location: null, notes: null, sharingScope: 'inherit',
  },
];
