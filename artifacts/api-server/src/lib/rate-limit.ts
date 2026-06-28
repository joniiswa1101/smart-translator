/**
 * Minimal in-memory rate limiter (sliding window, per-IP).
 * No external dependencies required.
 */

interface RateLimitEntry {
  count: number;
  windowStart: number;
}

const stores = new Map<string, Map<string, RateLimitEntry>>();

function getStore(key: string): Map<string, RateLimitEntry> {
  let store = stores.get(key);
  if (!store) {
    store = new Map();
    stores.set(key, store);
  }
  return store;
}

export interface RateLimitOptions {
  /** Unique name for this limiter (keeps separate counters) */
  name: string;
  /** Window duration in milliseconds */
  windowMs: number;
  /** Max requests allowed in the window */
  max: number;
}

/**
 * Returns true if the request is allowed, false if rate limit exceeded.
 * Automatically resets the window when it expires.
 */
export function checkRateLimit(ip: string, opts: RateLimitOptions): boolean {
  const store = getStore(opts.name);
  const now = Date.now();
  const entry = store.get(ip);

  if (!entry || now - entry.windowStart >= opts.windowMs) {
    store.set(ip, { count: 1, windowStart: now });
    return true;
  }

  if (entry.count >= opts.max) {
    return false;
  }

  entry.count += 1;
  return true;
}

/**
 * Express middleware factory — applies rate limiting to a route.
 */
import type { Request, Response, NextFunction } from "express";

export function rateLimitMiddleware(opts: RateLimitOptions) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const ip =
      (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ||
      req.socket.remoteAddress ||
      "unknown";

    if (!checkRateLimit(ip, opts)) {
      res.status(429).json({ error: "Too many requests. Please try again later." });
      return;
    }
    next();
  };
}

/**
 * Track concurrent WebSocket connections per IP.
 * Returns a cleanup function to call on disconnect.
 */
const wsConnectionCounts = new Map<string, number>();

export function trackWsConnection(ip: string, maxConcurrent: number): boolean {
  const current = wsConnectionCounts.get(ip) ?? 0;
  if (current >= maxConcurrent) {
    return false;
  }
  wsConnectionCounts.set(ip, current + 1);
  return true;
}

export function releaseWsConnection(ip: string): void {
  const current = wsConnectionCounts.get(ip) ?? 0;
  if (current <= 1) {
    wsConnectionCounts.delete(ip);
  } else {
    wsConnectionCounts.set(ip, current - 1);
  }
}
