import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

async function worker(fetcher) {
  const listeners = new Map();
  const stores = new Map();
  const caches = {
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      const entries = stores.get(name);
      return {
        async match(key) { return entries.get(typeof key === 'string' ? key : key.url)?.clone(); },
        async put(key, response) { entries.set(typeof key === 'string' ? key : key.url, response.clone()); },
      };
    },
    async keys() { return [...stores.keys()]; },
    async delete(name) { return stores.delete(name); },
  };
  const self = {
    location: { origin: 'https://example.test' },
    addEventListener(type, listener) { listeners.set(type, listener); },
    skipWaiting: async () => {},
    clients: { claim: async () => {} },
  };
  runInNewContext(await readFile(new URL('../public/sw.js', import.meta.url), 'utf8'),
    { self, caches, fetch: fetcher, URL });
  async function dispatch(url, mode = 'same-origin', method = 'GET') {
    let answer;
    listeners.get('fetch')({ request: { url: `https://example.test${url}`, mode, method },
      respondWith(promise) { answer = promise; } });
    return answer;
  }
  return { caches, listeners, dispatch };
}

const html = (text) => new Response(text, { headers: { 'content-type': 'text/html' } });

test('online navigation gets the new deploy shell; offline navigation falls back to the cached shell', async () => {
  let online = true;
  const sw = await worker(async () => {
    if (!online) throw new TypeError('offline');
    return html('new deployment');
  });
  const cache = await sw.caches.open('ichihime-web-shell-v3');
  await cache.put('/', html('old deployment'));
  assert.equal(await (await sw.dispatch('/history', 'navigate')).text(), 'new deployment');
  online = false;
  assert.equal(await (await sw.dispatch('/local/match', 'navigate')).text(), 'new deployment');
});

test('API and WebSocket traffic bypass the worker; only shell and assets enter its cache', async () => {
  const requests = [];
  const sw = await worker(async (request) => {
    requests.push(request.url);
    return new Response('data');
  });
  assert.equal(await sw.dispatch('/api', 'navigate'), undefined);
  assert.equal(await sw.dispatch('/ws', 'navigate'), undefined);
  assert.equal(await sw.dispatch('/api/me'), undefined);
  assert.equal(await sw.dispatch('/ws/matches/one'), undefined);
  assert.equal(await sw.dispatch('/private.json'), undefined);
  assert.equal((await sw.dispatch('/assets/app-123.js')).status, 200);
  assert.equal((await sw.dispatch('/assets/app-123.js')).status, 200);
  assert.deepEqual(requests, ['https://example.test/assets/app-123.js']);
  const cache = await sw.caches.open('ichihime-web-shell-v3');
  assert.equal(await (await cache.match('https://example.test/assets/app-123.js')).text(), 'data');
  assert.equal(await cache.match('https://example.test/api/me'), undefined);
});

test('activation discards old deploy caches', async () => {
  const sw = await worker(async () => html('current'));
  await sw.caches.open('ichihime-web-shell-v2');
  await sw.caches.open('unrelated');
  let pending;
  sw.listeners.get('activate')({ waitUntil(promise) { pending = promise; } });
  await pending;
  assert.deepEqual(await sw.caches.keys(), ['unrelated']);
});
