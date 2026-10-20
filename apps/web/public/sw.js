const SHELL = 'ichihime-web-shell-v2';

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    const response = await fetch('/', { cache: 'reload' });
    if (!response.ok) throw new Error('Unable to cache the app shell');
    const html = await response.clone().text();
    await cache.put('/', response);
    const assets = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
      .map((match) => new URL(match[1], self.location.origin))
      .filter((url) => url.origin === self.location.origin && url.pathname.startsWith('/assets/'));
    await cache.addAll(assets.map((url) => url.href));
    const stylesheet = assets.find((url) => url.pathname.endsWith('.css'));
    if (stylesheet) {
      const css = await (await cache.match(stylesheet.href)).text();
      const fonts = [...new Set(css.match(/\/assets\/(?:lxgwwenkaiscreen-subset-|nunito-)[^)"']+\.woff2/g) ?? [])];
      await cache.addAll(fonts);
    }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    await Promise.all((await caches.keys()).filter((key) => key.startsWith('ichihime-web-shell-') && key !== SHELL)
      .map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || request.method !== 'GET' || url.pathname.startsWith('/api/')) return;
  if (request.mode === 'navigate') {
    event.respondWith(caches.match('/').then((cached) => cached || fetch(request)));
    if (self.navigator.onLine) {
      event.waitUntil(fetch(request).then(async (response) => {
        if (response.ok) await (await caches.open(SHELL)).put('/', response);
      }).catch(() => {}));
    }
    return;
  }
  event.respondWith(caches.match(request, { ignoreVary: true }).then(async (cached) => {
    if (cached) return cached;
    const response = await fetch(request);
    if (response.ok) await (await caches.open(SHELL)).put(request, response.clone());
    return response;
  }));
});
