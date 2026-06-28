/**
 * Scoped one-time proxy token store.
 *
 * Tokens are scoped by purpose prefix so a proxy token can never be
 * mistaken for a different kind of single-use credential (or vice versa).
 * Each token is single-use and expires after TTL_MS.
 */

const TTL_MS = 5 * 60 * 1000; // 5 minutes

interface TokenEntry {
  purpose: string;
  expiresAt: number;
}

const store = new Map<string, TokenEntry>();

function issue(purpose: string): string {
  const token = `${purpose}_${crypto.randomUUID()}`;
  store.set(token, { purpose, expiresAt: Date.now() + TTL_MS });
  return token;
}

function consume(token: string, purpose: string): boolean {
  const entry = store.get(token);
  if (!entry) return false;
  store.delete(token);
  if (entry.purpose !== purpose) return false;
  if (Date.now() > entry.expiresAt) return false;
  return true;
}

// Periodic GC to avoid unbounded growth.
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store.entries()) {
    if (now > entry.expiresAt) store.delete(key);
  }
}, 60_000);

/**
 * Issue a single-use proxy token.
 * Only granted after the caller has been authenticated (via API key).
 * Must be presented when upgrading to the /ws WebSocket.
 */
export function issueProxyToken(): string {
  return issue("proxy");
}

/**
 * Consume a proxy token.
 * Returns true only if the token was issued as a proxy token, is present,
 * and has not expired. Consuming removes it (single-use).
 */
export function consumeProxyToken(token: string): boolean {
  return consume(token, "proxy");
}
