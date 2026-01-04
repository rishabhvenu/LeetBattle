import Redis, { Cluster } from 'ioredis';

let redis: Cluster | Redis | null = null;

export function getRedis(): Cluster | Redis {
  if (!redis) {
    const host = process.env.REDIS_HOST || '';
    const port = parseInt(process.env.REDIS_PORT || '6379', 10);
    const password = process.env.REDIS_PASSWORD || undefined;
    
    // Check if Redis Cluster mode is enabled
    // Enable cluster if explicitly set to 'true' - will use REDIS_CLUSTER_NODES if provided,
    // otherwise falls back to REDIS_HOST:REDIS_PORT as the initial node (ioredis auto-discovers)
    const isCluster = process.env.REDIS_CLUSTER_ENABLED === 'true';
    
    if (isCluster) {
      // Redis Cluster mode - use cluster nodes from env or REDIS_HOST:REDIS_PORT as entry point
      // ioredis Cluster client will auto-discover other nodes from the initial connection
      const clusterNodesEnv = process.env.REDIS_CLUSTER_NODES?.trim();
      const clusterNodes = clusterNodesEnv
        ? clusterNodesEnv.split(',').map(node => {
            const [h, p] = node.trim().split(':');
            return { host: h, port: parseInt(p || '6379', 10) };
          })
        : [{ host, port }]; // Fallback to REDIS_HOST:REDIS_PORT as initial node
      
      console.log(`Redis: Using CLUSTER mode with ${clusterNodes.length} initial node(s): ${clusterNodes.map(n => `${n.host}:${n.port}`).join(', ')}`);
      
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
      console.log(`Redis: Using STANDALONE mode with ${host}:${port}`);
      redis = new Redis({ 
        host, 
        port, 
        password, 
        lazyConnect: true,  // Don't connect immediately - wait until first command
        maxRetriesPerRequest: 3,  // Allow retries for transient failures
        connectTimeout: 5000,  // 5 second connection timeout
        commandTimeout: 5000,  // 5 second command timeout
        enableOfflineQueue: true,  // Queue commands when Redis is offline - prevents "Stream isn't writeable" errors
        retryStrategy: (times: number) => {
          // Retry with exponential backoff, max 3 seconds
          const delay = Math.min(times * 50, 3000);
          return delay;
        },
        reconnectOnError: (err: Error) => {
          // Reconnect on connection errors
          const errorMessage = err.message.toLowerCase();
          return errorMessage.includes('read econnreset') || 
                 errorMessage.includes('connection closed') || 
                 errorMessage.includes('connection is closed');
        },
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


