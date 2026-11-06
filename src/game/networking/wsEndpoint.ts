/**
 * Browser-safe session URL resolution.
 *
 * The online page is served either over `http:` (LAN/VPN development) or
 * `https:` (a TLS deployment). A page served over https cannot open a plain
 * `ws://` socket, so the default scheme follows the page protocol. An explicit
 * `ws://` or `wss://` in the field always wins, which keeps the historical LAN
 * runbook (`ws://HOST:PORT`) working unchanged.
 */

const DEFAULT_HOST = '127.0.0.1:8787';

export function sessionScheme(pageProtocol: string): 'ws' | 'wss' {
  return pageProtocol === 'https:' ? 'wss' : 'ws';
}

/** Default field value for a fresh page. */
export function defaultServerUrl(pageProtocol: string): string {
  return `${sessionScheme(pageProtocol)}://${DEFAULT_HOST}`;
}

/**
 * Resolves what the operator typed.
 * - empty: the page-protocol default;
 * - `ws://` / `wss://`: kept verbatim (explicit override);
 * - `http://` / `https://`: mapped to `ws://` / `wss://`;
 * - a bare `host:port`: adopts the page scheme;
 * - any other explicit scheme is returned unchanged so URL validation can
 *   reject it with a clear message.
 */
export function resolveServerUrl(raw: string, pageProtocol: string): string {
  const value = raw.trim();
  if (value.length === 0) return defaultServerUrl(pageProtocol);
  if (/^wss?:\/\//i.test(value)) return value;
  if (/^https?:\/\//i.test(value)) return value.replace(/^http/i, 'ws');
  // Any other explicit scheme is returned unchanged so URL validation rejects it.
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return value;
  // A bare host or host:port adopts the page scheme; `example.test:8787` is a
  // host, not a scheme, because it has no `//`.
  return `${sessionScheme(pageProtocol)}://${value}`;
}
