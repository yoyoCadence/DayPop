/** Pure client/sender boundary; keep capability URLs out of diagnostics. */
export function isAllowedPushEndpoint(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 20 && value.length <= 2048 &&
    value.trim() === value && Array.from(value).every(char => char.charCodeAt(0) > 31 && char.charCodeAt(0) !== 127) &&
    /^https:\/\/(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|[a-z0-9-]+\.push\.apple\.com|[a-z0-9-]+\.notify\.windows\.com)\/[^#\s]+$/.test(value);
}
