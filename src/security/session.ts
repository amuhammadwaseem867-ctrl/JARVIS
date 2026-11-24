/**
 * Silvia: session bootstrap.
 *
 * The backend prints (or Electron loads) a link with #token=... in the hash.
 * The hash never reaches the server logs or Referer headers. We move the token
 * into sessionStorage, remove it from the address bar, and attach it to every
 * same-origin /api request.
 */
const KEY = 'ultron_session_token';
let token = '';

function readToken(): string {
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const fromHash = hash.get('token');
  if (fromHash) {
    try {
      sessionStorage.setItem(KEY, fromHash);
    } catch {}
    hash.delete('token');
    const rest = hash.toString();
    history.replaceState(null, '', window.location.pathname + window.location.search + (rest ? `#${rest}` : ''));
    return fromHash;
  }
  try {
    return sessionStorage.getItem(KEY) || '';
  } catch {
    return '';
  }
}

export function hasSessionToken(): boolean {
  return Boolean(token);
}

export function installSecureFetch() {
  token = readToken();
  const nativeFetch = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const target = new URL(url, window.location.origin);
    if (target.origin === window.location.origin && target.pathname.startsWith('/api/')) {
      const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
      headers.set('X-Ultron-Token', token);
      return nativeFetch(input, { ...init, headers, credentials: 'same-origin' });
    }
    return nativeFetch(input, init);
  };
}

/** Only plain web links may be opened by the assistant. */
export function safeExternalUrl(raw: unknown): string | null {
  try {
    const u = new URL(String(raw || ''));
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    if (u.username || u.password) return null;
    return u.href;
  } catch {
    return null;
  }
}
