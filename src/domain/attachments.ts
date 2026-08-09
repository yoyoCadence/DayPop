export const EVENT_ATTACHMENT_BUCKET = 'event-attachments';
export const MAX_EVENT_ATTACHMENT_BYTES = 10 * 1024 * 1024;

export const EVENT_ATTACHMENT_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/heic',
  'image/heif',
  'application/pdf',
  'text/plain',
  'text/calendar',
] as const;

export type EventAttachmentMimeType = (typeof EVENT_ATTACHMENT_MIME_TYPES)[number];

export interface AttachmentFileLike {
  name: string;
  size: number;
  type: string;
}

export function isEventAttachmentMimeType(value: unknown): value is EventAttachmentMimeType {
  return EVENT_ATTACHMENT_MIME_TYPES.includes(value as EventAttachmentMimeType);
}

export function eventAttachmentFileIssue(file: AttachmentFileLike): string | null {
  if (file.name.trim() === '' || file.name !== file.name.trim() || file.name.length > 255) {
    return '檔名必須是 1–255 個字元，且開頭與結尾不能有空白。';
  }
  if (!Number.isInteger(file.size) || file.size < 1 || file.size > MAX_EVENT_ATTACHMENT_BYTES) {
    return '附件大小必須介於 1 byte 與 10 MiB。';
  }
  if (!isEventAttachmentMimeType(file.type)) {
    return '只支援 JPG、PNG、WebP、GIF、HEIC、PDF、純文字與 iCalendar 檔案。';
  }
  return null;
}

export function eventAttachmentObjectPath(
  ownerId: string,
  eventId: string,
  attachmentId: string,
): string {
  return `${ownerId}/${eventId}/${attachmentId}`;
}

export function formatAttachmentBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
