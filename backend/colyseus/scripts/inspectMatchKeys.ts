/**
 * Diagnostic script to inspect Redis match keys
 * Usage: npx ts-node scripts/inspectMatchKeys.ts [matchId]
 * Example: npx ts-node scripts/inspectMatchKeys.ts 69172c2ff2fe3cd6bee9c13c
 */

import { Cluster, Redis } from 'ioredis';
import * as fs from 'fs';
import * as path from 'path';

// Load environment variables from .env file manually
const envPath = path.join(__dirname, '../.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf-8');
  envContent.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
      const [key, ...valueParts] = trimmed.split('=');
      const value = valueParts.join('=').trim();
      if (key && value && !process.env[key]) {
        process.env[key] = value;
      }
    }
  });
}

// Set defaults if not in .env
if (!process.env.REDIS_HOST) {
  process.env.REDIS_HOST = 'localhost';
}
if (!process.env.REDIS_PORT) {
  process.env.REDIS_PORT = '6379';
}

// Redis keys definitions (duplicated to avoid mongo dependency)
const RedisKeys = {
  eloQueue: 'queue:elo',
  activeMatchesSet: 'matches:active',
  matchKey: (matchId: string) => `match:${matchId}`,
};

// Get Redis connection directly without MongoDB dependency
function getRedis(): Redis | Cluster {
  if (!process.env.REDIS_HOST || !process.env.REDIS_PORT) {
    throw new Error('REDIS_HOST and REDIS_PORT environment variables are required');
  }
  const host = process.env.REDIS_HOST;
  const port = parseInt(process.env.REDIS_PORT, 10);
  const password = process.env.REDIS_PASSWORD;
  
  // Check if Redis Cluster mode is enabled
  const isCluster = process.env.REDIS_CLUSTER_ENABLED === 'true' || 
                    process.env.REDIS_CLUSTER_NODES !== undefined;
  
  if (isCluster) {
    // Redis Cluster mode
    const clusterNodes = process.env.REDIS_CLUSTER_NODES
      ? process.env.REDIS_CLUSTER_NODES.split(',').map(node => {
          const [h, p] = node.trim().split(':');
          return { host: h, port: parseInt(p || '6379', 10) };
        })
      : [{ host, port }];
    
    return new Cluster(clusterNodes, {
      redisOptions: {
        password,
        maxRetriesPerRequest: 3,
      },
      clusterRetryStrategy: (times: number) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
      enableOfflineQueue: false,
      enableReadyCheck: true,
    });
  } else {
    // Single Redis instance mode
    return new Redis({
      host,
      port,
      password,
      maxRetriesPerRequest: 3,
    });
  }
}

/**
 * Scan Redis for keys matching a pattern
 */
async function scanRedisKeys(redis: any, pattern: string): Promise<string[]> {
  const keys: string[] = [];
  let cursor = '0';
  
  do {
    const result = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
    cursor = result[0];
    keys.push(...result[1]);
  } while (cursor !== '0');
  
  return keys;
}

/**
 * Get all members from a Redis set
 */
async function getSetMembers(redis: any, key: string): Promise<string[]> {
  return await redis.smembers(key);
}

/**
 * Main inspection function
 */
async function inspectMatchKeys(specificMatchId?: string) {
  const redis = getRedis();
  
  console.log('=== Redis Match Key Inspection ===\n');
  
  try {
    // 1. Scan all match keys
    console.log('1. Scanning for all match keys (match:*)...');
    const allMatchKeys = await scanRedisKeys(redis, 'match:*');
    console.log(`   Found ${allMatchKeys.length} match keys:\n`);
    
    if (allMatchKeys.length > 0) {
      // Group keys by type
      const matchBlobKeys = allMatchKeys.filter(k => !k.includes(':user:') && !k.includes(':ratings') && !k.includes(':code:'));
      const matchRatingKeys = allMatchKeys.filter(k => k.includes(':ratings'));
      const matchCodeKeys = allMatchKeys.filter(k => k.includes(':code:'));
      const matchSubmissionKeys = allMatchKeys.filter(k => k.includes(':submission:'));
      
      console.log(`   - Match blob keys (match:${'<id>'}): ${matchBlobKeys.length}`);
      matchBlobKeys.slice(0, 20).forEach(key => {
        console.log(`     • ${key}`);
      });
      if (matchBlobKeys.length > 20) {
        console.log(`     ... and ${matchBlobKeys.length - 20} more`);
      }
      
      if (matchRatingKeys.length > 0) {
        console.log(`\n   - Match rating keys (match:${'<id>'}:ratings): ${matchRatingKeys.length}`);
        matchRatingKeys.slice(0, 10).forEach(key => {
          console.log(`     • ${key}`);
        });
      }
      
      if (matchCodeKeys.length > 0) {
        console.log(`\n   - Match code keys (match:${'<id>'}:code:${'<userId>'}): ${matchCodeKeys.length}`);
      }
      
      if (matchSubmissionKeys.length > 0) {
        console.log(`\n   - Match submission keys: ${matchSubmissionKeys.length}`);
      }
    } else {
      console.log('   No match keys found');
    }
    
    // 2. Check matches:active set
    console.log('\n2. Checking matches:active set...');
    const activeMatches = await getSetMembers(redis, RedisKeys.activeMatchesSet);
    console.log(`   Found ${activeMatches.length} active matches:\n`);
    
    if (activeMatches.length > 0) {
      activeMatches.slice(0, 50).forEach(matchId => {
        console.log(`   • ${matchId}`);
      });
      if (activeMatches.length > 50) {
        console.log(`   ... and ${activeMatches.length - 50} more`);
      }
    } else {
      console.log('   No active matches found');
    }
    
    // 3. Check specific match if provided
    if (specificMatchId) {
      console.log(`\n3. Checking specific match: ${specificMatchId}...\n`);
      
      const matchKey = RedisKeys.matchKey(specificMatchId);
      console.log(`   Looking for key: ${matchKey}`);
      
      // Check if key exists
      const exists = await redis.exists(matchKey);
      console.log(`   Key exists: ${exists ? 'YES' : 'NO'}`);
      
      if (exists) {
        // Get the value
        const matchData = await redis.get(matchKey);
        if (matchData) {
          try {
            const parsed = JSON.parse(matchData);
            console.log(`   Match data structure:`);
            console.log(`     - matchId: ${parsed.matchId}`);
            console.log(`     - problemId: ${parsed.problemId}`);
            console.log(`     - status: ${parsed.status}`);
            console.log(`     - startedAt: ${parsed.startedAt}`);
            console.log(`     - players: ${Object.keys(parsed.players || {}).join(', ')}`);
          } catch (e) {
            console.log(`   Match data (unparseable): ${matchData.substring(0, 200)}...`);
          }
        }
      } else {
        // Check variations
        console.log(`   Checking for key variations...`);
        const variations = [
          `match:${specificMatchId}`,
          `matches:${specificMatchId}`,
          specificMatchId,
          `match_${specificMatchId}`,
        ];
        
        for (const variant of variations) {
          const exists = await redis.exists(variant);
          if (exists) {
            console.log(`   ✓ Found variant: ${variant}`);
          }
        }
      }
      
      // Check if in active matches set
      const isActive = await redis.sismember(RedisKeys.activeMatchesSet, specificMatchId);
      console.log(`   In matches:active set: ${isActive ? 'YES' : 'NO'}`);
      
      // Check for rating hash
      const ratingKey = `match:${specificMatchId}:ratings`;
      const ratingExists = await redis.exists(ratingKey);
      if (ratingExists) {
        const ratings = await redis.hgetall(ratingKey);
        console.log(`   Rating hash exists: ${ratingKey}`);
        console.log(`   Rating data:`, ratings);
      }
    }
    
    // 4. Check specific user's reservation if matchId provided
    if (specificMatchId) {
      // Try to find which user has this matchId in their reservation
      console.log('\n4. Searching for reservation containing matchId...');
      const reservationKeys = await scanRedisKeys(redis, 'queue:reservation:*');
      console.log(`   Found ${reservationKeys.length} total reservation keys\n`);
      
      let foundReservation = false;
      for (const key of reservationKeys) {
        try {
          const value = await redis.get(key);
          if (value) {
            const parsed = JSON.parse(value);
            if (parsed.matchId === specificMatchId) {
              const userId = key.replace('queue:reservation:', '');
              console.log(`   ✓ Found reservation for userId: ${userId}`);
              console.log(`     Reservation data:`, JSON.stringify(parsed, null, 2));
              foundReservation = true;
            }
          }
        } catch (e) {
          // Skip unparseable values
        }
      }
      
      if (!foundReservation) {
        console.log(`   ✗ No reservation found containing matchId ${specificMatchId}`);
      }
    }
    
    // 5. Scan all reservation keys
    console.log('\n5. Scanning all reservation keys (queue:reservation:*)...');
    const reservationKeys = await scanRedisKeys(redis, 'queue:reservation:*');
    console.log(`   Found ${reservationKeys.length} reservation keys\n`);
    
    if (reservationKeys.length > 0) {
      const recentReservations: Array<{ key: string; data: any }> = [];
      
      for (const key of reservationKeys.slice(0, 20)) {
        try {
          const value = await redis.get(key);
          if (value) {
            const parsed = JSON.parse(value);
            recentReservations.push({ key, data: parsed });
          }
        } catch (e) {
          // Skip unparseable values
        }
      }
      
      if (recentReservations.length > 0) {
        console.log('   Recent reservation data:');
        recentReservations.forEach(({ key, data }) => {
          const userId = key.replace('queue:reservation:', '');
          console.log(`   • ${userId}:`);
          console.log(`     - matchId: ${data.matchId || 'N/A'}`);
          console.log(`     - roomId: ${data.roomId || 'N/A'}`);
          console.log(`     - problemId: ${data.problemId || 'N/A'}`);
        });
        
        // Check if specific matchId appears in reservations
        if (specificMatchId) {
          const matchingReservations = recentReservations.filter(
            r => r.data.matchId === specificMatchId
          );
          if (matchingReservations.length > 0) {
            console.log(`\n   ✓ Found ${matchingReservations.length} reservation(s) for match ${specificMatchId}:`);
            matchingReservations.forEach(r => {
              console.log(`     • ${r.key}`);
            });
          } else {
            console.log(`\n   ✗ No reservations found for match ${specificMatchId}`);
          }
        }
      }
    }
    
    // 5. Check for Redis cluster info (if applicable)
    if (redis instanceof Cluster) {
      console.log('\n5. Redis Cluster Information:');
      const nodes = redis.nodes();
      console.log(`   Cluster nodes: ${nodes.length}`);
      nodes.forEach((node: any, idx: number) => {
        console.log(`   - Node ${idx + 1}: ${node.options.host}:${node.options.port}`);
      });
      
      if (specificMatchId) {
        const matchKey = RedisKeys.matchKey(specificMatchId);
        console.log(`   Match key: ${matchKey}`);
        console.log(`   Note: In cluster mode, keys are distributed across nodes based on hash slots`);
      }
    }
    
    console.log('\n=== Inspection Complete ===\n');
    
  } catch (error) {
    console.error('Error during inspection:', error);
    throw error;
  } finally {
    // Close Redis connection
    redis.disconnect();
  }
}

// Run if called directly
if (require.main === module) {
  const matchId = process.argv[2];
  inspectMatchKeys(matchId)
    .then(() => {
      console.log('Done');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Script failed:', error);
      process.exit(1);
    });
}

export { inspectMatchKeys };

