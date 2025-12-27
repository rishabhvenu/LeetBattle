/**
 * Redis Helper Functions
 * Extracted from index.ts to improve modularity
 */

import { RedisOptions } from 'ioredis';
import { RedisPresence } from '@colyseus/redis-presence';
import { RedisDriver } from '@colyseus/redis-driver';

export type RedisEndpoint = { host: string; port: number };

export interface RedisScalingConfig {
  options: RedisOptions;
  endpoints?: RedisEndpoint[];
}

/**
 * Parse cluster endpoints from comma-separated string
 * Format: "host1:port1,host2:port2,..."
 */
export function parseClusterEndpoints(raw?: string | null): RedisEndpoint[] | undefined {
  if (!raw) {
    return undefined;
  }

  const endpoints = raw
    .split(',')
    .map((segment) => segment.trim())
    .filter(Boolean)
    .map((segment) => {
      const [host, rawPort] = segment.split(':');
      const port = parseInt(rawPort ?? '6379', 10);
      if (!host) {
        return undefined;
      }
      return {
        host,
        port: Number.isNaN(port) ? 6379 : port,
      } satisfies RedisEndpoint;
    })
    .filter((endpoint): endpoint is RedisEndpoint => Boolean(endpoint));

  return endpoints.length > 0 ? endpoints : undefined;
}

/**
 * Build Redis configuration from environment variables
 * Supports both single-node and cluster configurations
 */
export function buildRedisScalingConfig(): RedisScalingConfig {
  if (!process.env.REDIS_HOST || !process.env.REDIS_PORT) {
    throw new Error('REDIS_HOST and REDIS_PORT environment variables are required');
  }

  const options: RedisOptions = {
    host: process.env.REDIS_HOST,
    port: parseInt(process.env.REDIS_PORT, 10),
    password: process.env.REDIS_PASSWORD || undefined,
  };

  if (process.env.REDIS_USERNAME) {
    (options as unknown as { username: string }).username = process.env.REDIS_USERNAME;
  }

  if (process.env.REDIS_DB) {
    const db = parseInt(process.env.REDIS_DB, 10);
    if (!Number.isNaN(db)) {
      options.db = db;
    }
  }

  if ((process.env.REDIS_TLS || '').toLowerCase() === 'true') {
    options.tls = {
      rejectUnauthorized: (process.env.REDIS_TLS_REJECT_UNAUTHORIZED || '').toLowerCase() !== 'false',
    };
  }

  const endpoints = parseClusterEndpoints(process.env.REDIS_CLUSTER_NODES);

  return { options, endpoints };
}

/**
 * Create Redis Presence for Colyseus
 */
export function createRedisPresence(config: RedisScalingConfig): RedisPresence {
  if (config.endpoints) {
    console.log('Redis: Using cluster mode with', config.endpoints.length, 'nodes');
    return new RedisPresence(config.endpoints as any, {
      redisOptions: config.options,
    } as any);
  } else {
    console.log('Redis: Using single-node mode at', config.options.host, ':', config.options.port);
    return new RedisPresence(config.options);
  }
}

/**
 * Create Redis Driver for Colyseus
 */
export function createRedisDriver(config: RedisScalingConfig): RedisDriver {
  if (config.endpoints) {
    return new RedisDriver(config.endpoints as any, {
      redisOptions: config.options,
    } as any);
  } else {
    return new RedisDriver(config.options);
  }
}

