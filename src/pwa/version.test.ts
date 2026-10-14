import { describe, expect, it } from 'vitest';
import releaseNotes from '../../release-notes.json';
import versionJson from '../../public/version.json';
import { isNewerVersion, parseReleaseInfo, ReleaseInfoError } from './version';

describe('isNewerVersion', () => {
  it('detects major, minor and patch updates', () => {
    expect(isNewerVersion('2.0.0', '1.9.9')).toBe(true);
    expect(isNewerVersion('1.3.0', '1.2.9')).toBe(true);
    expect(isNewerVersion('1.2.4', '1.2.3')).toBe(true);
  });

  it('does not treat the current or older version as an update', () => {
    expect(isNewerVersion('1.2.3', '1.2.3')).toBe(false);
    expect(isNewerVersion('1.2.2', '1.2.3')).toBe(false);
  });
});

describe('parseReleaseInfo (DP-153)', () => {
  const VALID = {
    version: '9.9.9',
    releasedAt: '2026-10-14',
    title: '下一版',
    changes: ['改了一件事', '又改了一件事'],
  };

  it('accepts the shipped version.json and every release note ever published', () => {
    expect(parseReleaseInfo(versionJson)).toEqual(versionJson);
    for (const release of releaseNotes.releases) expect(parseReleaseInfo(release)).toEqual(release);
  });

  it('accepts a release with no changes listed', () => {
    expect(parseReleaseInfo({ ...VALID, changes: [] }).changes).toEqual([]);
  });

  it('keeps only the four known fields', () => {
    expect(parseReleaseInfo({ ...VALID, injected: '<script>' })).toEqual(VALID);
  });

  it.each([
    ['null', null],
    ['an array', [VALID]],
    ['a string', '0.4.2'],
    ['changes missing', { ...VALID, changes: undefined }],
    ['changes null', { ...VALID, changes: null }],
    ['changes a string', { ...VALID, changes: '改了一件事' }],
    ['changes holding an object', { ...VALID, changes: [{ text: '改了一件事' }] }],
    ['changes holding a number', { ...VALID, changes: [1] }],
    ['changes holding a blank line', { ...VALID, changes: ['  '] }],
    ['too many changes', { ...VALID, changes: Array.from({ length: 51 }, (_, n) => `第 ${n} 項`) }],
    ['an overlong change', { ...VALID, changes: ['字'.repeat(501)] }],
    ['version a number', { ...VALID, version: 9 }],
    ['version missing', { ...VALID, version: undefined }],
    ['title missing', { ...VALID, title: undefined }],
    ['title an object', { ...VALID, title: { zh: '下一版' } }],
    ['releasedAt missing', { ...VALID, releasedAt: undefined }],
  ])('refuses %s', (_label, value) => {
    expect(() => parseReleaseInfo(value)).toThrow(ReleaseInfoError);
  });
});
