/**
 * Room Helper Functions
 * Extracted from index.ts to improve modularity
 */

/**
 * Generate a random 6-character room code
 * Uses alphanumeric characters excluding similar-looking ones (I, O, 1, 0)
 */
export function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

/**
 * Validate room code format
 */
export function isValidRoomCode(code: string): boolean {
  return /^[A-Z2-9]{6}$/.test(code);
}

