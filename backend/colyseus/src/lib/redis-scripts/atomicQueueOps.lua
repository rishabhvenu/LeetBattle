-- atomicQueueOps.lua
-- Atomic operations for queue state management to prevent race conditions
--
-- Operation 1: checkAndRemoveFromQueue
-- Atomically check if user is in queue and remove them
-- KEYS[1]: queue:elo
-- KEYS[2]: queue:reservation:{userId}
-- ARGV[1]: userId
-- ARGV[2]: operation = "checkAndRemove"
-- Returns: 1 if removed, 0 if not in queue

-- Operation 2: checkAndSetReservation
-- Atomically check if user has no reservation and set one
-- KEYS[1]: queue:reservation:{userId}
-- ARGV[1]: userId
-- ARGV[2]: operation = "checkAndSet"
-- ARGV[3]: reservationData (JSON string)
-- ARGV[4]: ttl (seconds)
-- Returns: 1 if set, 0 if already exists

local operation = ARGV[2]

if operation == "checkAndRemove" then
  local queueKey = KEYS[1]
  local userId = ARGV[1]
  
  -- Check if user is in queue
  local score = redis.call('ZSCORE', queueKey, userId)
  if score then
    -- Remove from queue
    redis.call('ZREM', queueKey, userId)
    return 1
  end
  return 0

elseif operation == "checkAndSet" then
  local reservationKey = KEYS[1]
  local reservationData = ARGV[3]
  local ttl = tonumber(ARGV[4]) or 300
  
  -- Check if reservation already exists
  local exists = redis.call('EXISTS', reservationKey)
  if exists == 0 then
    -- Set reservation with TTL
    redis.call('SETEX', reservationKey, ttl, reservationData)
    return 1
  end
  return 0

else
  error("Unknown operation: " .. tostring(operation))
end

