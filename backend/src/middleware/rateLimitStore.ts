import { Store, Options, IncrementResponse, MemoryStore } from "express-rate-limit";

/**
 * Shared Upstash REST Redis Store for express-rate-limit
 *
 * Implements express-rate-limit's Store interface directly against Upstash's
 * HTTP REST API using standard global fetch. Zero native C/C++ dependencies,
 * zero connection pool leaks, and fully shared across serverless/container instances.
 */
export class UpstashRedisStore implements Store {
  localKeys = false;
  prefix: string;
  private url: string;
  private token: string;
  private windowMs: number = 60 * 1000;
  private failClosed: boolean;

  constructor(prefix: string, url: string, token: string, failClosed: boolean = false) {
    this.prefix = prefix;
    this.url = url.replace(/\/+$/, "");
    this.token = token;
    this.failClosed = failClosed;
  }

  init(options: Options): void {
    if (options.windowMs) {
      this.windowMs = options.windowMs;
    }
  }

  async increment(key: string): Promise<IncrementResponse> {
    const fullKey = `${this.prefix}:${key}`;
    try {
      const response = await fetch(`${this.url}/pipeline`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify([
          ["INCR", fullKey],
          ["PTTL", fullKey],
        ]),
      });

      if (!response.ok) {
        throw new Error(`Upstash request failed with HTTP ${response.status}`);
      }

      const [incrRes, pttlRes] = (await response.json()) as [
        { result: number },
        { result: number }
      ];

      const totalHits = Number(incrRes?.result) || 1;
      let pttl = Number(pttlRes?.result);

      if (pttl < 0) {
        await fetch(`${this.url}/pexpire/${encodeURIComponent(fullKey)}/${this.windowMs}`, {
          method: "POST",
          headers: { Authorization: `Bearer ${this.token}` },
        });
        pttl = this.windowMs;
      }

      const resetTime = new Date(Date.now() + (pttl > 0 ? pttl : this.windowMs));
      return { totalHits, resetTime };
    } catch (err) {
      console.error(`[RateLimitStore] Upstash increment error for ${fullKey}:`, err);
      if (this.failClosed) {
        // N-H4: Fail-closed for sensitive endpoints (auth/passwords/lockouts)
        return { totalHits: Number.MAX_SAFE_INTEGER, resetTime: new Date(Date.now() + this.windowMs) };
      }
      // Fallback response allowing fail-open on transient store network partition for non-sensitive operations
      return { totalHits: 1, resetTime: new Date(Date.now() + this.windowMs) };
    }
  }

  async decrement(key: string): Promise<void> {
    const fullKey = `${this.prefix}:${key}`;
    try {
      await fetch(`${this.url}/decr/${encodeURIComponent(fullKey)}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.token}` },
      });
    } catch (err) {
      console.error(`[RateLimitStore] Upstash decrement error for ${fullKey}:`, err);
    }
  }

  async resetKey(key: string): Promise<void> {
    const fullKey = `${this.prefix}:${key}`;
    try {
      await fetch(`${this.url}/del/${encodeURIComponent(fullKey)}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.token}` },
      });
    } catch (err) {
      console.error(`[RateLimitStore] Upstash resetKey error for ${fullKey}:`, err);
    }
  }
}

/**
 * Store factory:
 * If UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are configured,
 * returns an UpstashRedisStore instance. Otherwise falls back to MemoryStore
 * for local development and test environments.
 */
export function getRateLimitStore(prefix: string, failClosed: boolean = false): Store {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();

  const isPlaceholder =
    !url ||
    !token ||
    url.includes("your-database.upstash.io") ||
    url.includes("example.com") ||
    token.includes("your_upstash_rest_token");

  if (!isPlaceholder && url && token) {
    return new UpstashRedisStore(prefix, url, token, failClosed);
  }

  return new MemoryStore();
}
