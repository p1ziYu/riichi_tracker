const SHELL = 'ichihime-web-shell-v3';

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
  if (url.origin !== self.location.origin || request.method !== 'GET' ||
      url.pathname === '/api' || url.pathname.startsWith('/api/') ||
      url.pathname === '/ws' || url.pathname.startsWith('/ws/')) return;
  if (request.mode === 'navigate') {
    // Always ask the server for the current shell. A cache-first navigation can
    // strand an installed client on the previous deploy indefinitely.
    event.respondWith((async () => {
      let response;
      try {
        response = await fetch(request);
      } catch (error) {
        const cached = await (await caches.open(SHELL)).match('/');
        if (cached) return cached;
        throw error;
      }
      if (response.ok && response.headers.get('content-type')?.includes('text/html')) {
        await (await caches.open(SHELL)).put('/', response.clone());
      }
      return response;
    })());
    return;
  }
  if (!url.pathname.startsWith('/assets/')) return;
  event.respondWith((async () => {
    const cache = await caches.open(SHELL);
    const cached = await cache.match(request);
    if (cached) return cached;
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  })());
});
