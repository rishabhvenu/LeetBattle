import { RedisPresence } from '@colyseus/redis-presence';
import { RedisDriver } from '@colyseus/redis-driver';
import Redis, { RedisOptions, ClusterNode, ClusterOptions } from 'ioredis';
import OpenAI from 'openai';
import AWS from 'aws-sdk';
import { getDbName } from './lib/mongo';

const DB_NAME = getDbName();
const isProduction = process.env.NODE_ENV === 'production';

export type RedisEndpoint = { host: string; port: number };

export interface RedisScalingConfig {
  options: RedisOptions;
  endpoints?: RedisEndpoint[];
}

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

export const redisScalingConfig = buildRedisScalingConfig();

export function createRedisPresence() {
  if (redisScalingConfig.endpoints && redisScalingConfig.endpoints.length > 0) {
    const clusterOptions: ClusterOptions = {
      redisOptions: redisScalingConfig.options,
    };
    return new RedisPresence(redisScalingConfig.endpoints as ClusterNode[], clusterOptions);
  }
  return new RedisPresence(redisScalingConfig.options as RedisOptions);
}

export function createRedisDriver() {
  if (redisScalingConfig.endpoints && redisScalingConfig.endpoints.length > 0) {
    const clusterOptions: ClusterOptions = {
      redisOptions: redisScalingConfig.options,
    };
    return new RedisDriver(redisScalingConfig.endpoints as ClusterNode[], clusterOptions);
  }
  return new RedisDriver(redisScalingConfig.options as RedisOptions);
}

export function resolveReservationSecret(): string {
  const secret = process.env.COLYSEUS_RESERVATION_SECRET;
  if (!secret || (secret === 'dev_secret' && isProduction)) {
    throw new Error('COLYSEUS_RESERVATION_SECRET must be configured in production.');
  }
  return secret || 'dev_secret';
}

export function createOpenAIClient(): OpenAI {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY environment variable is required');
  }
  return new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });
}

export function createS3Client(): AWS.S3 {
  const s3Config: AWS.S3.ClientConfiguration = {
    endpoint: process.env.S3_ENDPOINT || undefined,
    accessKeyId: process.env.S3_ACCESS_KEY_ID || undefined,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || undefined,
    region: process.env.S3_REGION || 'us-east-1',
    s3ForcePathStyle: (process.env.S3_FORCE_PATH_STYLE || '').toLowerCase() === 'true',
  };

  if (process.env.S3_ENDPOINT) {
    s3Config.endpoint = process.env.S3_ENDPOINT;
  }

  return new AWS.S3(s3Config);
}

export { DB_NAME, isProduction };

