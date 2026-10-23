export function routeFromExternalUrl(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl);
    if (url.origin !== 'https://riichi.p1ziyu.com' || url.username || url.password ||
      !/^\/checkin\/[^/?#]+$/.test(url.pathname)) return null;
    return url.pathname + url.search;
  } catch {
    return null;
  }
}
