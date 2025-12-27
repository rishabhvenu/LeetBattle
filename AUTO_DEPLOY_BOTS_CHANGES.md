# Auto-Deploy New Bots Feature

## Summary
When new bots are created via the admin panel, they are now automatically added to the rotation queue and will be deployed if the current deployed count is below the configured minimum threshold.

## Changes Made

### 1. Backend API Endpoint (`backend/colyseus/src/index.ts`)

**Modified**: `POST /admin/bots/generate` endpoint (lines 1743-1783)

After inserting new bots into MongoDB:
- Adds all new bot IDs to the Redis rotation queue (`bots:rotation:queue`)
- Publishes a `checkDeployment` command to the bot service via Redis pub/sub
- Updates response message to indicate bots were added to rotation queue

```typescript
// Add newly created bots to rotation queue
const redis = getRedis();
const newBotIds = Object.keys(result.insertedIds).map(key => result.insertedIds[parseInt(key)].toString());

try {
  // Add new bots to rotation queue
  for (const botId of newBotIds) {
    await redis.rpush(RedisKeys.botsRotationQueue, botId);
  }
  console.log(`Added ${newBotIds.length} new bots to rotation queue`);
  
  // Trigger deployment check via pub/sub to deploy if below minimum
  await redis.publish(RedisKeys.botsCommandsChannel, JSON.stringify({
    type: 'checkDeployment',
    reason: 'new_bots_created',
    count: newBotIds.length
  }));
  console.log(`Notified bot service of ${newBotIds.length} new bots`);
} catch (redisError) {
  console.error('Failed to add bots to rotation queue:', redisError);
  // Continue - bots are created in MongoDB, they can be added to rotation manually
}
```

### 2. Bot Service Command Handler (`backend/bots/index.js`)

**Modified**: Command listener switch statement (lines 161-198)

Added new command type handler:
```javascript
case 'checkDeployment':
  // New bots added, check if we need to deploy them
  console.log(`Check deployment triggered: ${command.reason || 'unknown reason'}`);
  await checkAndManageBotDeployment(redis, { context: command.reason || 'checkDeployment' });
  break;
```

This handler:
- Triggers the deployment check function immediately
- Passes through the reason (e.g., 'new_bots_created') for logging
- Allows the periodic deployment logic to pick up new bots from the rotation queue

### 3. Documentation Updates

**Updated**: `context/backend/bot-lifecycle.md`
- Added section 6: "Auto-Deployment of New Bots"
- Updated command handling section to include `checkDeployment`
- Updated `bots:rotation:queue` description to note auto-addition on creation

**Updated**: `backend/bots/README.md`
- Added note about automatic rotation queue addition in Bot Identity Management section
- Added `checkDeployment` command to Pub/Sub Channels documentation

## How It Works

1. **Admin creates bots** via the admin panel (calls `/admin/bots/generate`)
2. **Bots are inserted** into MongoDB with `deployed: false`
3. **Bot IDs are added** to Redis `bots:rotation:queue` (RPUSH operation)
4. **Pub/sub notification** sent to `bots:commands` channel with `checkDeployment` command
5. **Bot service leader** receives the command and calls `checkAndManageBotDeployment()`
6. **Deployment check** evaluates:
   - Current deployed count vs minimum threshold (`minDeployed` from `bots:rotation:config`)
   - If below minimum, pops bot IDs from rotation queue and deploys them
   - Each deployed bot connects to Colyseus QueueRoom and joins the matchmaking queue

## Benefits

- **Automatic scaling**: No manual intervention needed to deploy bots after creation
- **Minimum threshold maintained**: System automatically ensures minimum bots are always deployed
- **Seamless experience**: Players joining the queue immediately have bots available to match with
- **Graceful degradation**: If Redis operations fail, bots are still created in MongoDB and can be deployed manually

## Deployment Notes

- No environment variable changes required
- Backward compatible with existing bot management
- Bot service must be running and have an active leader for auto-deployment
- If bot service is not running, bots will be created but not deployed (can be deployed later when service starts)

## Testing Recommendations

1. Start with 0 deployed bots and minimum threshold set to 5
2. Create 3 new bots via admin panel
3. Verify in logs that:
   - Bots are added to rotation queue
   - `checkDeployment` command is published
   - Bot service receives command and triggers deployment
   - 3 bots are automatically deployed (or all 3 if below minimum)
4. Check Redis:
   ```bash
   redis-cli lrange bots:rotation:queue 0 -1  # Should show remaining bots
   redis-cli smembers bots:deployed           # Should show deployed bots
   ```
5. Verify bots appear in queue and can match with players

## Rollback Plan

If issues arise, the feature can be disabled by:
1. Reverting the changes to `backend/colyseus/src/index.ts` (remove Redis operations after bot insertion)
2. Recompiling TypeScript: `cd backend/colyseus && npm run build`
3. Restarting Colyseus service
4. Bots will be created normally but won't auto-deploy (original behavior)

