import assert from 'node:assert/strict';
import { test } from 'node:test';
import { localSupabaseHttpConfig, localSupabaseFetch } from './local-supabase-http.mjs';
const valid = { API_URL: 'http://127.0.0.1:54321', ANON_KEY: 'synthetic-public', SERVICE_ROLE_KEY: 'synthetic-admin' };

test('accepts only the explicit local CLI credentials without environment fallback', () => {
  const value = localSupabaseHttpConfig(JSON.stringify(valid));
  assert.equal(value.url.origin, 'http://127.0.0.1:54321');
  assert.equal(value.publicKey, valid.ANON_KEY);
  assert.equal(value.adminKey, valid.SERVICE_ROLE_KEY);
});
test('malformed CLI output fails without echoing its contents', () => {
  assert.throws(() => localSupabaseHttpConfig('{do-not-print-credential'), error => !error.message.includes('do-not-print'));
  for (const value of [null, [], 'text', 0]) assert.throws(() => localSupabaseHttpConfig(JSON.stringify(value)));
});
for (const url of ['https://project.supabase.co', 'http://localhost:54321', 'https://127.0.0.1:54321', 'http://[::1]:54321']) {
  test(`rejects the wrong API origin ${url}`, () => {
    assert.throws(() => localSupabaseHttpConfig(JSON.stringify({ ...valid, API_URL: url })));
  });
}
test('does not disclose rejected URL credentials or accept an API path, query or fragment', () => {
  for (const url of ['http://private:do-not-print@127.0.0.1:54321', 'http://127.0.0.1:54321/rest/v1', 'http://127.0.0.1:54321/?secret=do-not-print', 'http://127.0.0.1:54321/#do-not-print']) {
    assert.throws(() => localSupabaseHttpConfig(JSON.stringify({ ...valid, API_URL: url })), error => !error.message.includes('do-not-print'));
  }
});
test('missing, non-string or blank local keys cannot start a test', () => {
  for (const name of ['ANON_KEY', 'SERVICE_ROLE_KEY']) {
    for (const key of [undefined, null, '', ' ', 123]) assert.throws(() => localSupabaseHttpConfig(JSON.stringify({ ...valid, [name]: key })));
  }
});
test('outbound fence blocks a different host, port, protocol and userinfo before fetch', () => {
  let calls = 0;
  const request = localSupabaseFetch(valid.API_URL, () => { calls += 1; });
  for (const url of ['https://project.supabase.co/auth/v1/admin/users', 'http://127.0.0.1:54322/', 'https://127.0.0.1:54321/', 'http://private:do-not-print@127.0.0.1:54321/']) {
    assert.throws(() => request(url), error => !error.message.includes('do-not-print'));
  }
  assert.equal(calls, 0);
});
test('local requests preserve the method/body but reject redirects and have a deadline', async () => {
  let sent;
  const request = localSupabaseFetch(valid.API_URL, async (input, init) => { sent = { input, init }; return 'local-response'; });
  const url = valid.API_URL + '/auth/v1/token';
  assert.equal(await request(url, { method: 'POST', body: 'synthetic-body', redirect: 'follow' }), 'local-response');
  assert.equal(sent.input, url);
  assert.equal(sent.init.method, 'POST');
  assert.equal(sent.init.body, 'synthetic-body');
  assert.equal(sent.init.redirect, 'error');
  assert.ok(sent.init.signal instanceof AbortSignal);
});
