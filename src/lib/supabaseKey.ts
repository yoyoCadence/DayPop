/**
 * Tells a browser-safe Supabase key apart from a privileged one — DP-033.
 *
 * The frontend is only ever allowed the publishable (anon) key. A secret key
 * pasted into `VITE_SUPABASE_PUBLISHABLE_KEY` by mistake would be compiled into
 * the public JavaScript bundle and hand every visitor full, RLS-bypassing
 * access to the database. "Is it non-empty" cannot catch that, and neither can
 * a plaintext scan of the bundle: a legacy `service_role` JWT carries its role
 * inside a base64url payload, so the literal string never appears.
 *
 * This module is the single source of truth for that judgement. It is imported
 * by `env.ts` (runtime, before a client is created) and by `vite.config.ts`
 * (build time, so a bad key fails the build instead of shipping).
 *
 * It is deliberately fail-closed: anything not positively recognised as a
 * publishable or `anon` key is rejected. It never returns, logs or embeds the
 * key itself — only the classification.
 *
 * https://supabase.com/docs/guides/api/api-keys
 */

export type SupabaseKeyKind =
  /** `sb_publishable_…` — the current browser-safe format. */
  | 'publishable'
  /** Legacy JWT with `"role": "anon"`. */
  | 'anon-jwt'
  /** `sb_secret_…` — server only. */
  | 'secret'
  /** Legacy JWT with `"role": "service_role"`. */
  | 'service-role-jwt'
  /** Not recognised. Treated exactly like a privileged key: rejected. */
  | 'unknown';

const PUBLISHABLE_PREFIX = 'sb_publishable_';
const SECRET_PREFIX = 'sb_secret_';

export function classifySupabaseKey(value: string | undefined): SupabaseKeyKind {
  const key = value?.trim() ?? '';
  if (key === '') return 'unknown';
  if (key.startsWith(PUBLISHABLE_PREFIX)) return 'publishable';
  if (key.startsWith(SECRET_PREFIX)) return 'secret';

  const role = readJwtRole(key);
  if (role === 'anon') return 'anon-jwt';
  if (role === 'service_role') return 'service-role-jwt';
  return 'unknown';
}

/** Only `publishable` and `anon-jwt` may ever reach a browser. */
export function isBrowserSafeSupabaseKey(kind: SupabaseKeyKind): boolean {
  return kind === 'publishable' || kind === 'anon-jwt';
}

/**
 * Explains a rejection without ever quoting the key. The wording is what a
 * developer sees in a failed build, so it names the fix rather than the value.
 */
export function describeSupabaseKeyProblem(kind: SupabaseKeyKind): string {
  switch (kind) {
    case 'secret':
      return 'VITE_SUPABASE_PUBLISHABLE_KEY 是 sb_secret_ 開頭的私密金鑰，只能用在伺服器端。請改用 sb_publishable_ 開頭的金鑰。';
    case 'service-role-jwt':
      return 'VITE_SUPABASE_PUBLISHABLE_KEY 是 service_role 金鑰，會繞過所有 RLS，絕對不能進入前端。請改用 publishable／anon 金鑰。';
    default:
      return 'VITE_SUPABASE_PUBLISHABLE_KEY 不是可辨識的 publishable／anon 金鑰。前端只接受 sb_publishable_ 開頭的金鑰，或 role 為 anon 的舊式 JWT。';
  }
}

/**
 * Reads `role` out of a JWT payload, or `null` if the value is not a JWT this
 * module can read. Any failure returns `null`, which the caller treats as
 * `unknown` and rejects.
 */
function readJwtRole(key: string): string | null {
  const segments = key.split('.');
  if (segments.length !== 3) return null;

  const payload = decodeBase64Url(segments[1] ?? '');
  if (payload === null) return null;

  try {
    const parsed: unknown = JSON.parse(payload);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const role = (parsed as { role?: unknown }).role;
    return typeof role === 'string' ? role : null;
  } catch {
    return null;
  }
}

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * Hand-rolled rather than `atob`: this module is imported by `vite.config.ts`,
 * which is typechecked under a Node tsconfig with no DOM lib — the same reason
 * `csp.ts` avoids `new URL()`.
 *
 * Returns Latin-1 text. JWT payloads are ASCII JSON in practice; anything else
 * fails `JSON.parse` above and is rejected, which is the safe direction.
 */
function decodeBase64Url(segment: string): string | null {
  if (segment === '') return null;

  let bits = 0;
  let bitCount = 0;
  let output = '';

  for (const character of segment.replaceAll('-', '+').replaceAll('_', '/')) {
    if (character === '=') break;
    const index = BASE64_ALPHABET.indexOf(character);
    if (index < 0) return null;

    bits = (bits << 6) | index;
    bitCount += 6;
    if (bitCount >= 8) {
      bitCount -= 8;
      output += String.fromCharCode((bits >> bitCount) & 0xff);
    }
  }

  return output;
}
