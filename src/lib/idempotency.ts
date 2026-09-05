/**
 * Idempotency layer for telemetry ingestion.
 *
 * Prevents duplicate processing when devices retry on network failure.
 * Uses Redis to store a fingerprint of recently processed requests.
 */

import { getRedisClient } from "./redis";

const IDEMPOTENCY_TTL_SECONDS = 3600; // 1 hour

/**
 * Generates an idempotency key from installation ID + timestamp (minute precision).
 * Same installation posting within the same minute gets deduplicated.
 */
export function generateIdempotencyKey(
  installationId: string,
  timestamp: Date
): string {
  const minute = timestamp.toISOString().slice(0, 16); // YYYY-MM-DDTHH:MM
  return `idemp:${installationId}:${minute}`;
}

/**
 * Checks if a request has already been processed.
 * Returns true if this is a duplicate.
 */
export async function isDuplicate(key: string): Promise<boolean> {
  const redis = getRedisClient();
  try {
    const exists = await redis.exists(key);
    return exists === 1;
  } catch {
    return false; // If Redis is down, don't block (fail-open)
  }
}

/**
 * Marks a request as processed. Sets with TTL for automatic cleanup.
 */
export async function markProcessed(key: string): Promise<void> {
  const redis = getRedisClient();
  try {
    await redis.set(key, "1", { ex: IDEMPOTENCY_TTL_SECONDS });
  } catch {
    // Non-fatal
  }
}
