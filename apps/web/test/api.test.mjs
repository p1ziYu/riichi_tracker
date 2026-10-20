import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { api, clearNativeAuthToken, isNative, webSocketUrl } from '../src/api.ts';

const originalWindow = globalThis.window;
const originalStorage = globalThis.localStorage;
const originalFetch = globalThis.fetch;
const tokenKey = 'riichi.native.auth-token';

function environment(origin = 'capacitor://localhost') {
  const tokens = new Map();
  globalThis.window = { location: new URL(origin) };
  globalThis.localStorage = {
    getItem: (key) => tokens.get(key) ?? null,
    setItem: (key, value) => tokens.set(key, value),
    removeItem: (key) => tokens.delete(key),
  };
  return tokens;
}

afterEach(() => {
  globalThis.window = originalWindow;
  globalThis.localStorage = originalStorage;
  globalThis.fetch = originalFetch;
});

test('native login captures the exposed bearer, reuses it, and clears it on session expiry', async () => {
  const tokens = environment();
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    if (requests.length === 1) return new Response('{}', { headers: { 'set-auth-token': 'session-a' } });
    return new Response('{"message":"Session expired"}', { status: 401 });
  };
  await api('/api/auth/sign-in/email', { method: 'POST', body: '{}' });
  assert.equal(tokens.get(tokenKey), 'session-a');
  await assert.rejects(api('/api/me'), /Session expired/);
  assert.equal(requests[0].url, 'https://riichi.p1ziyu.com/api/auth/sign-in/email');
  assert.equal(requests[1].options.headers.get('Authorization'), 'Bearer session-a');
  assert.equal(tokens.has(tokenKey), false);
  clearNativeAuthToken();
  assert.equal(tokens.has(tokenKey), false);
});

test('an older unauthorized request cannot erase a newly issued login token', async () => {
  const tokens = environment();
  tokens.set(tokenKey, 'old');
  let finishOld;
  globalThis.fetch = (url) => url.endsWith('/api/me')
    ? new Promise((resolve) => { finishOld = resolve; })
    : Promise.resolve(new Response('{}', { headers: { 'set-auth-token': 'new' } }));
  const stale = api('/api/me');
  await api('/api/auth/sign-in/email', { method: 'POST', body: '{}' });
  finishOld(new Response('{"message":"expired"}', { status: 401 }));
  await assert.rejects(stale, /expired/);
  assert.equal(tokens.get(tokenKey), 'new');
  clearNativeAuthToken();
  assert.equal(tokens.has(tokenKey), false);
});

test('a seat-approval rejection preserves the login and exposes its machine-readable reason', async () => {
  const tokens = environment();
  tokens.set(tokenKey, 'valid-session');
  globalThis.fetch = async () => new Response(JSON.stringify({
    error: 'check_in_not_approved',
    message: 'Caller does not have an approved seat assignment for this match',
  }), { status: 403 });
  await assert.rejects(api('/api/matches/one/check-ins', { method: 'POST', body: '{}' }),
    (error) => error.status === 403 && error.code === 'check_in_not_approved');
  assert.equal(tokens.get(tokenKey), 'valid-session');
});

test('localhost development with a port uses relative API and WebSocket URLs', async () => {
  const tokens = environment('http://localhost:5173/');
  tokens.set(tokenKey, 'native-only');
  globalThis.fetch = async (url, options) => {
    assert.equal(url, '/api/me');
    assert.equal(options.credentials, 'include');
    assert.equal(options.headers.Authorization, undefined);
    return new Response('{}');
  };
  assert.equal(isNative(), false);
  assert.equal(webSocketUrl('/ws/matches/abc'), 'ws://localhost:5173/ws/matches/abc');
  await api('/api/me');
  assert.equal(tokens.get(tokenKey), 'native-only');
});
