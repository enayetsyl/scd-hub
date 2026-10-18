/**
 * The caller's network address, for the login lockout (D-#765).
 *
 * Node only ever sees Caddy, so the address comes from a header. `X-Real-IP` is the one
 * to trust: the VM's Caddyfile OVERWRITES it on every API request with Caddy's own
 * `{client_ip}` — the visitor's address when the request came through Cloudflare (whose
 * ranges Caddy trusts), the connecting address otherwise — so a client cannot forge it.
 * The other two are fallbacks for a setup without that line (local dev, a test harness).
 */
const IP_HEADERS = ["x-real-ip", "cf-connecting-ip", "x-forwarded-for"] as const;

export function clientIpFrom(get: (name: string) => string | null | undefined): string | null {
  for (const name of IP_HEADERS) {
    const first = get(name)?.split(",")[0]?.trim();
    if (first) return first;
  }
  return null;
}
