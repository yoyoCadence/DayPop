export interface ReleaseInfo {
  version: string;
  releasedAt: string;
  title: string;
  changes: string[];
  dataSchemaVersion: number;
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
