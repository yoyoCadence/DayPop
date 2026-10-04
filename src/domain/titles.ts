/** PostgreSQL char_length counts Unicode code points, rather than UTF-16 units. */
export const MAX_TITLE_LENGTH = 300;
// Native maxlength uses UTF-16. Leave room for 300 supplementary characters;
// the shared code-point check below is the actual product limit.
export const MAX_TITLE_INPUT_LENGTH = MAX_TITLE_LENGTH * 2;
export const TITLE_LENGTH_MESSAGE = `標題最多 ${MAX_TITLE_LENGTH} 字，請縮短後再儲存。`;

export function isTitleTooLong(title: string): boolean {
  return Array.from(title.trim()).length > MAX_TITLE_LENGTH;
}

export class TitleInputError extends Error {
  constructor() {
    super(TITLE_LENGTH_MESSAGE);
    this.name = 'TitleInputError';
  }
}

export function assertTitleLength(title: string): void {
  if (isTitleTooLong(title)) throw new TitleInputError();
}
