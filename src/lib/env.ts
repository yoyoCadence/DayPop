export interface SupabasePublicConfig {
  url: string;
  publishableKey: string;
}

export interface PublicEnvironment {
  VITE_SUPABASE_URL?: string;
  VITE_SUPABASE_PUBLISHABLE_KEY?: string;
}

export class SupabaseConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SupabaseConfigurationError';
  }
}

export function readSupabasePublicConfig(env: PublicEnvironment): SupabasePublicConfig {
  const url = env.VITE_SUPABASE_URL?.trim();
  const publishableKey = env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();

  if (!url || !publishableKey) {
    throw new SupabaseConfigurationError(
      '缺少 VITE_SUPABASE_URL 或 VITE_SUPABASE_PUBLISHABLE_KEY。',
    );
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new SupabaseConfigurationError('VITE_SUPABASE_URL 不是有效網址。');
  }

  const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
  const isSecureRemote = parsedUrl.protocol === 'https:';
  const isLocalDevelopment =
    parsedUrl.protocol === 'http:' && loopbackHosts.has(parsedUrl.hostname);

  if (!isSecureRemote && !isLocalDevelopment) {
    throw new SupabaseConfigurationError('Supabase URL 必須使用 HTTPS；本機開發可使用 HTTP loopback。');
  }

  return { url: parsedUrl.toString().replace(/\/$/, ''), publishableKey };
}
