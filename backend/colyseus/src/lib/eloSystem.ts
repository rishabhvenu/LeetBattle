/**
 * ELO System Functions
 * 
 * Pure functions for calculating problem difficulty probabilities and ELO adjustments.
 * All functions are side-effect free and configurable.
 */

export interface DifficultyConfig {
  Easy: number;    // target ELO
  Medium: number;  // target ELO
  Hard: number;    // target ELO
}

// Default configuration constants
export const DEFAULT_TARGET_ELOS: DifficultyConfig = {
  Easy: 1200,
  Medium: 1500,
  Hard: 2000
};

export const DEFAULT_GAUSSIAN_SIGMA = 250;
export const DEFAULT_SCALE_FACTOR = 1000;
export const DEFAULT_MIN_MULTIPLIER = 0.5;
export const DEFAULT_MAX_MULTIPLIER = 2.0;

/**
 * Calculate Gaussian probabilities for each difficulty based on average player rating
 * 
 * @param avgRating - Average rating of matched players
 * @param targetElos - Target ELO ratings for each difficulty level
 * @param sigma - Standard deviation for Gaussian distribution
 * @returns Normalized probabilities for each difficulty (sums to 1)
 */
export function calculateProblemDifficultyProbabilities(
  avgRating: number,
  targetElos: DifficultyConfig = DEFAULT_TARGET_ELOS,
  sigma: number = DEFAULT_GAUSSIAN_SIGMA
): Record<string, number> {
  // Calculate Gaussian probabilities for each difficulty
  const probabilities: Record<string, number> = {};
  
  for (const [difficulty, targetElo] of Object.entries(targetElos)) {
    const distance = Math.pow(avgRating - targetElo, 2);
    probabilities[difficulty] = Math.exp(-distance / (2 * Math.pow(sigma, 2)));
  }
  
  // Normalize probabilities to sum to 1 (softmax-like)
  const totalProbability = Object.values(probabilities).reduce((sum, prob) => sum + prob, 0);
  const normalizedProbs = Object.fromEntries(
    Object.entries(probabilities).map(([diff, prob]) => [diff, prob / totalProbability])
  );
  
  return normalizedProbs;
}

/**
 * Select a difficulty using weighted random selection based on probabilities
 * 
 * @param probabilities - Probability map for each difficulty (should sum to 1)
 * @returns Selected difficulty string
 */
export function selectDifficultyByProbability(
  probabilities: Record<string, number>
): string {
  const random = Math.random();
  let cumulativeProbability = 0;
  
  for (const [difficulty, probability] of Object.entries(probabilities)) {
    cumulativeProbability += probability;
    if (random <= cumulativeProbability) {
      return difficulty;
    }
  }
  
  // Fallback to Medium if no difficulty selected (shouldn't happen with normalized probabilities)
  return 'Medium';
}

/**
 * Calculate difficulty adjustment multiplier based on player rating vs problem ELO
 * 
 * @param playerRating - Current player rating
 * @param problemElo - Target ELO of the problem difficulty
 * @param scaleFactor - Scaling factor for the difficulty difference (default: 1000)
 * @param minMultiplier - Minimum multiplier to prevent extreme swings (default: 0.5)
 * @param maxMultiplier - Maximum multiplier to prevent extreme swings (default: 2.0)
 * @returns Difficulty adjustment multiplier
 */
export function calculateDifficultyMultiplier(
  playerRating: number,
  problemElo: number,
  scaleFactor: number = DEFAULT_SCALE_FACTOR,
  minMultiplier: number = DEFAULT_MIN_MULTIPLIER,
  maxMultiplier: number = DEFAULT_MAX_MULTIPLIER
): number {
  const difficultyModifier = 1 + ((problemElo - playerRating) / scaleFactor);
  return Math.max(minMultiplier, Math.min(maxMultiplier, difficultyModifier));
}

/**
 * Apply difficulty adjustment to base ELO change
 * 
 * @param baseEloChange - Base ELO change before adjustment
 * @param multiplier - Difficulty multiplier to apply
 * @returns Adjusted ELO change
 */
export function applyDifficultyAdjustment(
  baseEloChange: number,
  multiplier: number
): number {
  return Math.round(baseEloChange * multiplier);
}

/**
 * Get target ELO for a given difficulty
 * 
 * @param difficulty - Difficulty string (Easy, Medium, Hard)
 * @param targetElos - Target ELO configuration
 * @returns Target ELO for the difficulty
 */
export function getTargetEloForDifficulty(
  difficulty: string,
  targetElos: DifficultyConfig = DEFAULT_TARGET_ELOS
): number {
  return targetElos[difficulty as keyof DifficultyConfig] || targetElos.Medium;
}

/**
 * Calculate complete problem selection flow
 * 
 * @param avgRating - Average rating of matched players
 * @param targetElos - Target ELO configuration
 * @param sigma - Gaussian standard deviation
 * @returns Object containing selected difficulty and its target ELO
 */
export function selectProblemDifficulty(
  avgRating: number,
  targetElos: DifficultyConfig = DEFAULT_TARGET_ELOS,
  sigma: number = DEFAULT_GAUSSIAN_SIGMA
): { difficulty: string; targetElo: number } {
  const probabilities = calculateProblemDifficultyProbabilities(avgRating, targetElos, sigma);
  const difficulty = selectDifficultyByProbability(probabilities);
  const targetElo = getTargetEloForDifficulty(difficulty, targetElos);
  
  return { difficulty, targetElo };
}
