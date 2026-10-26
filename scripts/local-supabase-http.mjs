// Scope fence for the HTTP integration fixture's Node-only local admin key.
// Reject a wrong target before constructing a client, without echoing its URL
// or CLI output (either could contain credentials).
function localApiUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw Error('Local Supabase API URL is invalid'); }
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.pathname !== '/'
    || url.username || url.password || url.search || url.hash) throw Error('Only the local 127.0.0.1 HTTP API root is allowed');
  return url;
}

export function localSupabaseHttpConfig(raw) {
  let value;
  try { value = JSON.parse(raw); } catch { throw Error('Local CLI status must return JSON'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Local CLI status must be an object');
  const url = localApiUrl(value.API_URL);
  if (![value.ANON_KEY, value.SERVICE_ROLE_KEY].every(key => typeof key === 'string' && key.trim())) {
    throw Error('Local public/admin test keys must come from CLI status');
  }
  return { url, publicKey: value.ANON_KEY, adminKey: value.SERVICE_ROLE_KEY };
}

export function localSupabaseFetch(apiUrl, fetcher = fetch) {
  const origin = localApiUrl(apiUrl).origin;
  return (input, init) => {
    let target;
    try { target = new URL(input instanceof Request ? input.url : input); }
    catch { throw Error('Invalid local test request URL'); }
    if (target.origin !== origin || target.username || target.password) throw Error('Test requests must stay on this local origin');
    return fetcher(input, { ...init, redirect: 'error', signal: AbortSignal.timeout(15_000) });
  };
}
