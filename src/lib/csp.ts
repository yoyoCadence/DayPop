/**
 * The Content-Security-Policy DayPop ships with.
 *
 * Built here rather than hard-coded in `index.html` because `connect-src` has
 * to name the Supabase project for this build; everything else is same-origin
 * on purpose (DP-015).
 *
 * A meta tag is the delivery mechanism for now because no hosting platform has
 * been chosen yet (DP-033). Response headers are strictly better — they also
 * cover `frame-ancestors`, which the meta form ignores — so the header version
 * should be added when the platform lands, not replaced by it.
 */

export interface CspOptions {
  /** `VITE_SUPABASE_URL`, when the build has one. */
  supabaseUrl?: string;
}

export function buildContentSecurityPolicy(options: CspOptions = {}): string {
  const connect = new Set(["'self'"]);

  const origin = toOrigin(options.supabaseUrl);
  if (origin) {
    connect.add(origin);
    // Realtime is not used yet (DP-046), but auth refresh and PostgREST share
    // this origin, and a websocket upgrade is not covered by the https entry.
    connect.add(origin.replace(/^http/, 'ws'));
  }

  return [
    "default-src 'self'",
    // No CDN, no inline <script>. Vite emits a module bundle we serve ourselves.
    "script-src 'self'",
    // React writes `style` attributes for per-calendar colours and grid
    // geometry. `style-src-attr` keeps that working without opening up
    // `<style>` injection, which `unsafe-inline` on `style-src` would.
    "style-src 'self'",
    "style-src-attr 'unsafe-inline'",
    // Self-hosted woff2/woff from DP-052; no Google Fonts at runtime. `data:`
    // is required because Vite inlines font files under its asset size limit
    // straight into the stylesheet — without it three theme fonts are blocked.
    "font-src 'self' data:",
    // `data:` covers the inlined SVG icons Vite emits for small assets.
    "img-src 'self' data:",
    `connect-src ${[...connect].join(' ')}`,
    "worker-src 'self'",
    "manifest-src 'self'",
    // Nothing embeds DayPop and DayPop embeds nothing.
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
}

/**
 * Deliberately regex-based rather than `new URL()`: this module is imported by
 * `vite.config.ts`, which compiles under a Node tsconfig without the DOM lib.
 */
function toOrigin(value: string | undefined): string | null {
  const match = /^(https?):\/\/([^/?#]+)/i.exec(value?.trim() ?? '');
  if (!match) return null;
  return `${match[1]!.toLowerCase()}://${match[2]!.toLowerCase()}`;
}
