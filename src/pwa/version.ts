export interface ReleaseInfo {
  version: string;
  releasedAt: string;
  title: string;
  changes: string[];
}

/**
 * Far above any real release — the longest so far has 11 changes of at most
 * 53 characters — and far below what would swamp a dialog.
 */
const RELEASE_LIMITS = { text: 500, changes: 50 } as const;

/** `version.json` arrived but is not a release note the App can show — DP-153. */
export class ReleaseInfoError extends Error {
  constructor() {
    super('更新資訊格式不正確');
    this.name = 'ReleaseInfoError';
  }
}

/**
 * `version.json` as it arrived, checked before anything renders it — DP-153.
 *
 * The file is generated, but it reaches the App over the network and was
 * trusted with a type assertion. Two dialogs and the 設定 card render its
 * fields directly, so a 200 whose `changes` was missing, not a list, or held
 * an object threw while rendering; both dialogs sit outside the per-tab error
 * boundary, so the whole App was replaced by the root fallback. Throwing here
 * puts that answer on the path every failed check takes instead: silent when
 * automatic, explained when asked for. Only the four known fields are kept.
 */
export function parseReleaseInfo(value: unknown): ReleaseInfo {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ReleaseInfoError();
  }
  const { version, releasedAt, title, changes } = value as Record<string, unknown>;
  if (!isReleaseText(version) || !isReleaseText(releasedAt) || !isReleaseText(title)) {
    throw new ReleaseInfoError();
  }
  if (
    !Array.isArray(changes) ||
    changes.length > RELEASE_LIMITS.changes ||
    !changes.every(isReleaseText)
  ) {
    throw new ReleaseInfoError();
  }
  return { version, releasedAt, title, changes: [...changes] };
}

function isReleaseText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= RELEASE_LIMITS.text;
}

export function isNewerVersion(candidate: string, current: string): boolean {
  const left = parseVersion(candidate);
  const right = parseVersion(current);
  const length = Math.max(left.length, right.length);

  for (let index = 0; index < length; index += 1) {
    const candidatePart = left[index] ?? 0;
    const currentPart = right[index] ?? 0;
    if (candidatePart > currentPart) return true;
    if (candidatePart < currentPart) return false;
  }
  return false;
}

function parseVersion(version: string): number[] {
  return version
    .replace(/^v/i, '')
    .split('-')[0]
    ?.split('.')
    .map((part) => Number.parseInt(part, 10) || 0) ?? [0];
}
