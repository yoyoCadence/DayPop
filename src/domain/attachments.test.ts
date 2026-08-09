import { describe, expect, it } from 'vitest';
import {
  MAX_EVENT_ATTACHMENT_BYTES,
  eventAttachmentFileIssue,
  eventAttachmentObjectPath,
  formatAttachmentBytes,
} from './attachments';

describe('event attachments', () => {
  it('accepts the explicit safe allowlist within 10 MiB', () => {
    expect(eventAttachmentFileIssue({ name: 'agenda.pdf', size: 42, type: 'application/pdf' })).toBeNull();
    expect(
      eventAttachmentFileIssue({
        name: 'photo.heic',
        size: MAX_EVENT_ATTACHMENT_BYTES,
        type: 'image/heic',
      }),
    ).toBeNull();
  });

  it('rejects active content, empty files and oversized files', () => {
    expect(eventAttachmentFileIssue({ name: 'active.svg', size: 1, type: 'image/svg+xml' })).toMatch(/只支援/);
    expect(eventAttachmentFileIssue({ name: 'empty.txt', size: 0, type: 'text/plain' })).toMatch(/10 MiB/);
    expect(
      eventAttachmentFileIssue({
        name: 'large.pdf',
        size: MAX_EVENT_ATTACHMENT_BYTES + 1,
        type: 'application/pdf',
      }),
    ).toMatch(/10 MiB/);
  });

  it('builds a filename-free canonical object path', () => {
    expect(eventAttachmentObjectPath('owner', 'event', 'attachment')).toBe(
      'owner/event/attachment',
    );
  });

  it('formats sizes for the attachment list', () => {
    expect(formatAttachmentBytes(12)).toBe('12 B');
    expect(formatAttachmentBytes(1536)).toBe('2 KB');
    expect(formatAttachmentBytes(2 * 1024 * 1024)).toBe('2.0 MB');
  });
});
