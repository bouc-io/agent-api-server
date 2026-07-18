import Redis from 'ioredis';
import { createComponentLogger } from './logger';

const log = createComponentLogger('redis');
const globalForRedis = global as unknown as { redis: Redis | null };

const redisUrl = process.env.REDIS_URL;

if (!redisUrl) {
    log.warn('REDIS_URL not set, Redis features will be disabled');
}

// Create Redis connection with BullMQ-compatible settings
export const redis = redisUrl
    ? globalForRedis.redis ||
      new Redis(redisUrl, {
          maxRetriesPerRequest: null, // Required for BullMQ
          enableReadyCheck: false,
      })
    : null;

// Cache the connection in development to prevent multiple instances
if (process.env.NODE_ENV !== 'production' && redis) {
    globalForRedis.redis = redis;
}

/**
 * Check if Redis is available and connected
 */
export const isRedisAvailable = (): boolean => redis !== null;

/**
 * Gracefully close the Redis connection
 */
export const closeRedis = async (): Promise<void> => {
    if (redis) {
        await redis.quit();
    }
};
