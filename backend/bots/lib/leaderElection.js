// Leader election logic for bot service
'use strict';

const { LEADER_KEY, LEADER_TTL_MS, LEADER_RENEW_INTERVAL_MS, INSTANCE_ID } = require('./config');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Leadership state
const leadership = {
  isLeader: false,
  maintenanceTimer: null,
  pruneTimer: null,
};

/**
 * Attempt to become leader with atomic SET NX operation
 * @param {Redis} redis - Redis client
 * @returns {Promise<boolean>} - true if elected leader, false otherwise
 */
async function electLeader(redis) {
  try {
    const result = await redis.set(
      LEADER_KEY,
      INSTANCE_ID,
      'PX',
      LEADER_TTL_MS,
      'NX'
    );
    return result === 'OK';
  } catch (error) {
    console.error('Leadership election failed:', error);
    // Retry with exponential backoff
    await sleep(Math.min(1000 * 2, 30000));
    throw error; // Propagate error for retry logic
  }
}

/**
 * Extend leadership TTL atomically
 * @param {Redis} redis - Redis client
 * @returns {Promise<boolean>} - true if extended, false if not leader
 */
async function extendLeadership(redis) {
  try {
    const result = await redis.extendLeader(LEADER_KEY, INSTANCE_ID, LEADER_TTL_MS);
    return result === 1;
  } catch (error) {
    console.error('Failed to extend leadership:', error);
    return false;
  }
}

/**
 * Resign from leadership
 * @param {Redis} redis - Redis client
 */
async function resignLeadership(redis) {
  try {
    const currentLeader = await redis.get(LEADER_KEY);
    if (currentLeader === INSTANCE_ID) {
      await redis.del(LEADER_KEY);
      console.log(`Instance ${INSTANCE_ID} resigned as leader`);
    }
  } catch (error) {
    console.error('Error resigning leadership:', error);
  }
}

/**
 * Start leadership renewal loop
 * @param {Redis} redis - Redis client
 * @param {Function} onLoseLeadership - Callback when leadership is lost
 */
function startLeadershipRenewal(redis, onLoseLeadership) {
  if (leadership.maintenanceTimer) {
    clearInterval(leadership.maintenanceTimer);
  }

  leadership.maintenanceTimer = setInterval(async () => {
    if (!leadership.isLeader) {
      return;
    }

    const extended = await extendLeadership(redis);
    if (!extended) {
      console.warn(`Instance ${INSTANCE_ID} lost leadership`);
      leadership.isLeader = false;
      
      // Clear timers
      if (leadership.maintenanceTimer) {
        clearInterval(leadership.maintenanceTimer);
        leadership.maintenanceTimer = null;
      }
      if (leadership.pruneTimer) {
        clearInterval(leadership.pruneTimer);
        leadership.pruneTimer = null;
      }

      // Callback for cleanup
      if (onLoseLeadership) {
        try {
          await onLoseLeadership();
        } catch (err) {
          console.error('Error in onLoseLeadership callback:', err);
        }
      }
    }
  }, LEADER_RENEW_INTERVAL_MS);
}

/**
 * Election loop with retry logic
 * @param {Redis} redis - Redis client
 * @param {Function} onBecomeLeader - Callback when becoming leader
 * @param {Function} onLoseLeadership - Callback when losing leadership
 */
async function runElectionLoop(redis, onBecomeLeader, onLoseLeadership) {
  let retries = 0;
  const maxRetries = 10;

  while (true) {
    try {
      if (!leadership.isLeader) {
        const elected = await electLeader(redis);
        
        if (elected) {
          console.log(`Instance ${INSTANCE_ID} elected as leader`);
          leadership.isLeader = true;
          retries = 0; // Reset retry counter on success
          
          // Start renewal loop
          startLeadershipRenewal(redis, onLoseLeadership);
          
          // Callback for initialization
          if (onBecomeLeader) {
            try {
              await onBecomeLeader();
            } catch (err) {
              console.error('Error in onBecomeLeader callback:', err);
              // Continue despite error
            }
          }
        } else {
          // Not elected, wait and retry
          await sleep(LEADER_RENEW_INTERVAL_MS);
        }
      } else {
        // Already leader, wait before checking again
        await sleep(LEADER_RENEW_INTERVAL_MS);
      }
    } catch (error) {
      console.error('Error in election loop:', error);
      retries++;
      
      if (retries >= maxRetries) {
        console.error(`Election loop failed ${maxRetries} times, waiting longer before retry`);
        await sleep(30000); // Wait 30s before continuing
        retries = 0;
      } else {
        // Exponential backoff
        const backoff = Math.min(1000 * Math.pow(2, retries), 30000);
        await sleep(backoff);
      }
    }
  }
}

/**
 * Get current leadership state
 */
function getLeadershipState() {
  return {
    isLeader: leadership.isLeader,
    instanceId: INSTANCE_ID,
  };
}

/**
 * Cleanup leadership on shutdown
 * @param {Redis} redis - Redis client
 */
async function cleanupLeadership(redis) {
  // Clear all timers
  if (leadership.maintenanceTimer) {
    clearInterval(leadership.maintenanceTimer);
    leadership.maintenanceTimer = null;
  }
  if (leadership.pruneTimer) {
    clearInterval(leadership.pruneTimer);
    leadership.pruneTimer = null;
  }

  // Resign if leader
  if (leadership.isLeader) {
    await resignLeadership(redis);
    leadership.isLeader = false;
  }
}

module.exports = {
  leadership,
  electLeader,
  extendLeadership,
  resignLeadership,
  runElectionLoop,
  startLeadershipRenewal,
  getLeadershipState,
  cleanupLeadership,
};

