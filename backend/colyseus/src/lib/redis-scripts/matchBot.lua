-- matchBot.lua
-- Atomically dequeue a user from the ELO-sorted queue and match them with a bot
-- This prevents race conditions where multiple bots try to match the same user
--
-- KEYS[1]: queue:elo (sorted set of users by ELO rating)
-- ARGV[1]: botId (the bot that is trying to match)
-- ARGV[2]: timestamp (current timestamp for tracking)
-- ARGV[3]: minRating (minimum ELO rating to consider, default 0)
-- ARGV[4]: maxRating (maximum ELO rating to consider, default +inf)
--
-- Returns: JSON string with user data {userId, rating} or nil if no match found

local queueKey = KEYS[1]
local botId = ARGV[1]
local timestamp = ARGV[2]
local minRating = tonumber(ARGV[3]) or 0
local maxRating = tonumber(ARGV[4]) or math.huge

-- Get all users in the rating range, ordered by rating
local users = redis.call('ZRANGEBYSCORE', queueKey, minRating, maxRating, 'WITHSCORES', 'LIMIT', 0, 1)

if #users == 0 then
  return nil
end

local userId = users[1]
local rating = tonumber(users[2])

-- Remove the user from the queue atomically
redis.call('ZREM', queueKey, userId)

-- Return the matched user data as JSON
return cjson.encode({userId = userId, rating = rating, matchedAt = timestamp})

