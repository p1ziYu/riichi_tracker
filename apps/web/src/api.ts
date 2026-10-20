export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}

const NATIVE_API_ORIGIN = 'https://riichi.p1ziyu.com';
const NATIVE_WS_ORIGIN = 'wss://riichi.p1ziyu.com';
const TOKEN_KEY = 'riichi.native.auth-token';

export function isNative(): boolean {
  const capacitor = (window as Window & { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  return !!capacitor?.isNativePlatform?.() || window.location.protocol === 'capacitor:' ||
    ['https://localhost', 'http://localhost'].includes(window.location.origin);
}

export function webSocketUrl(path: string): string {
  if (isNative()) return `${NATIVE_WS_ORIGIN}${path}`;
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}${path}`;
}

export function clearNativeAuthToken(): void {
  if (isNative()) localStorage.removeItem(TOKEN_KEY);
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const native = isNative();
  const headers = new Headers(options.headers);
  const token = native ? localStorage.getItem(TOKEN_KEY) : null;
  if (native) {
    if (options.body) headers.set('Content-Type', headers.get('Content-Type') ?? 'application/json');
    if (token) headers.set('Authorization', `Bearer ${token}`);
  }
  let response: Response;
  try {
    response = await fetch(native ? `${NATIVE_API_ORIGIN}${path}` : path, {
      ...options,
      credentials: native ? 'omit' : 'include',
      headers: native ? headers : { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers },
    });
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : '网络连接失败');
  }
  if (!response.ok) {
    if (native && response.status === 401 && token && localStorage.getItem(TOKEN_KEY) === token) {
      localStorage.removeItem(TOKEN_KEY);
    }
    const body = await response.text();
    let message = body;
    let code: string | undefined;
    try {
      const parsed = JSON.parse(body) as { message?: string; error?: string };
      message = parsed.message ?? parsed.error ?? body;
      code = parsed.error;
    } catch { /* Non-JSON error response. */ }
    throw new ApiError(response.status, message || `请求失败 (${response.status})`, code);
  }
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  const value = (text ? JSON.parse(text) : undefined) as T;
  if (native && /^\/api\/auth\/(?:sign-in\/(?:email|anonymous)|sign-up\/email)$/.test(path)) {
    const bearer = response.headers.get('set-auth-token') ??
      (value as { token?: string } | undefined)?.token;
    if (bearer) localStorage.setItem(TOKEN_KEY, bearer);
  }
  return value;
}

export function post<T>(path: string, body: object = {}): Promise<T> {
  return api<T>(path, { method: 'POST', body: JSON.stringify(body) });
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : '请求失败，请重试';
}
