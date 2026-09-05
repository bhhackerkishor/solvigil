/**
 * Token-bucket rate limiter backed by Redis.
 *
 * Each API key gets a token bucket that refills at a configured rate.
 * Exceeding the limit returns 429 with Retry-After header.
 */

import redis from "./redis";

interface RateLimitConfig {
  maxTokens: number;      // max requests per window
  refillRate: number;     // tokens added per second
  windowSeconds: number;  // time window for burst protection
}

const DEFAULT_CONFIG: RateLimitConfig = {
  maxTokens: 30,
  refillRate: 1, // 1 token per 30 seconds
  windowSeconds: 60,
};


/**
 * Checks and consumes a rate limit token for a given key.
 * Returns { allowed, remaining, retryAfterMs }.
 */
export async function checkRateLimit(
  key: string,
  config: Partial<RateLimitConfig> = {}
): Promise<{ allowed: boolean; remaining: number; retryAfterMs: number }> {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const bucketKey = `ratelimit:${key}`;
  try {
    const now = Date.now();
    const bucket = await redis.hgetall(bucketKey);

    let tokens = bucket?.tokens ? parseFloat(bucket.tokens as string) : cfg.maxTokens;
    let lastRefill = bucket?.lastRefill ? parseInt(bucket.lastRefill as string) : now;

    // Refill tokens based on elapsed time
    const elapsed = (now - lastRefill) / 1000;
    tokens = Math.min(cfg.maxTokens, tokens + elapsed * cfg.refillRate);

    if (tokens < 1) {
      const waitTime = Math.ceil((1 - tokens) / cfg.refillRate * 1000);
      return { allowed: false, remaining: 0, retryAfterMs: waitTime };
    }

    // Consume one token
    tokens -= 1;
    await redis.hset(bucketKey, {
      tokens: tokens.toString(),
      lastRefill: now.toString(),
    });
    await redis.expire(bucketKey, cfg.windowSeconds * 2);

    return {
      allowed: true,
      remaining: Math.floor(tokens),
      retryAfterMs: 0,
    };
  } catch {
    // If Redis is down, allow the request (fail-open)
    return { allowed: true, remaining: 1, retryAfterMs: 0 };
  }
}
