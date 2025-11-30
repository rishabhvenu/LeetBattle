// Rate limiter configuration constants (no dependencies)

export const RATE_LIMITER_CONFIG = {
  general: {
    points: 10,
    duration: 10,
    blockDuration: 60,
  },
  auth: {
    points: 10, // Increased from 5 to allow for retries and shared IPs
    duration: 60,
    blockDuration: 120, // Reduced from 300 to 2 minutes
  },
  queue: {
    points: 20,
    duration: 10,
    blockDuration: 30,
  },
  admin: {
    points: 30,
    duration: 60,
    blockDuration: 300,
  },
  upload: {
    points: 2,
    duration: 60,
    blockDuration: 120,
  },
} as const;

