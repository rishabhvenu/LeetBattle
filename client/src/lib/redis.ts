import Redis, { Cluster } from 'ioredis';

let redis: Cluster | Redis | null = null;

export function getRedis(): Cluster | Redis {
  if (!redis) {
    const host = process.env.REDIS_HOST || '';
    const port = parseInt(process.env.REDIS_PORT || '6379', 10);
    const password = process.env.REDIS_PASSWORD || undefined;
    
    // Check if Redis Cluster mode is enabled
    const isCluster = process.env.REDIS_CLUSTER_ENABLED === 'true' || 
                      process.env.REDIS_CLUSTER_NODES !== undefined;
    
    if (isCluster) {
      // Redis Cluster mode - use cluster nodes from env or single entry point
      const clusterNodes = process.env.REDIS_CLUSTER_NODES
        ? process.env.REDIS_CLUSTER_NODES.split(',').map(node => {
            const [h, p] = node.trim().split(':');
            return { host: h, port: parseInt(p || '6379', 10) };
          })
        : [{ host, port }];
      
          redis = new Cluster(clusterNodes, {
            redisOptions: {
              password,
              lazyConnect: true,  // Don't connect immediately - wait until first command
              maxRetriesPerRequest: 3,
              connectTimeout: 5000,  // 5 second connection timeout
              commandTimeout: 5000,  // 5 second command timeout
            },
            clusterRetryStrategy: (times: number) => {
              const delay = Math.min(times * 50, 2000);
              return delay;
            },
            enableOfflineQueue: true,  // Queue commands when cluster is offline
            enableReadyCheck: true,
          });
    } else {
      // Single Redis instance mode (backward compatibility)
      redis = new Redis({ 
        host, 
        port, 
        password, 
        lazyConnect: true,  // Don't connect immediately - wait until first command
        maxRetriesPerRequest: 3,
        connectTimeout: 5000,  // 5 second connection timeout
        commandTimeout: 5000,  // 5 second command timeout
        enableOfflineQueue: true,  // Queue commands when Redis is offline
      });
    }
    
    // Error handling
    redis.on('error', (err) => {
      console.error('Redis connection error:', err.message);
    });
    
    // Cluster-specific event handlers
    if (isCluster && redis instanceof Cluster) {
      redis.on('+node', (node) => {
        console.log(`Redis cluster node added: ${node.options.host}:${node.options.port}`);
      });
      
      redis.on('-node', (node) => {
        console.log(`Redis cluster node removed: ${node.options.host}:${node.options.port}`);
      });
    }
  }
  return redis;
}

export const RedisKeys = {
  userStats: (userId: string) => `user:${userId}:stats`,
  userActivity: (userId: string) => `user:${userId}:activity`,
  activeMatchesSet: 'matches:active',
  matchKey: (matchId: string) => `match:${matchId}`,
  // Per-match, per-user source code storage (hash of language -> code)
  matchUserCodeHash: (matchId: string, userId: string) => `match:${matchId}:code:${userId}`,
  matchEventsChannel: 'events:match',
} as const;


