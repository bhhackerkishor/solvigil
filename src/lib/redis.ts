// src/lib/redis.ts
import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL || "https://your-database-name.upstash.io",
  token: process.env.UPSTASH_REDIS_REST_TOKEN || "AXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
});

export function getRedisClient(): Redis {
  return redis;
}

/**
 * Get cached JSON or primitive data by key
 */
export async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    const data = await redis.get<T>(key);
    if (!data) return null;
    return data;
  } catch (error) {
    console.warn(`[Redis Cache] Failed to get key "${key}":`, error);
    return null;
  }
}

/**
 * Set cached data by key with TTL in seconds
 */
export async function cacheSet<T>(key: string, value: T, ttlSeconds: number = 300): Promise<void> {
  try {
    await redis.set(key, value, { ex: ttlSeconds });
  } catch (error) {
    console.warn(`[Redis Cache] Failed to set key "${key}":`, error);
  }
}

export default redis;