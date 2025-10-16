/**
 * Time Complexity Analyzer
 * Uses OpenAI gpt-4o-mini to analyze code time complexity
 */

import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const SYSTEM_PROMPT = `You are an expert algorithm analysis engine.

Task:
1. Read the provided code carefully.
2. Identify ALL input size parameters — e.g., n (array length), m, S (target sum/amount), etc.
   - List each parameter explicitly.
3. Trace the recursion or iteration pattern:
   - For recursive code: identify the recursion tree structure.
   - Count how many recursive calls are made at each level (branching factor).
   - Count the maximum depth of recursion.
   - If a loop contains recursive calls, each iteration is a separate branch.
4. Determine the branching factor:
   - If recursion branches a constant k times per call, use k as branching factor.
   - If recursion branches based on an input parameter (e.g., for i in range(amount)), use that parameter as branching factor.
   - If a loop from 0 to amount/coin[i] calls recursion, the branching factor is proportional to amount.
5. Calculate time complexity:
   - For recursion with branching factor B and depth D: O(B^D)
   - For recursion with memoization: O(unique states × work per state)
   - For nested independent loops: multiply the iteration counts
   - For divide-and-conquer: apply Master Theorem
6. Express the result in Big-O notation using the original parameter names:
   - Use 'n' for array/list length
   - Use 'S' or 'amount' or 'target' for sum/capacity parameters (match the code)
   - Use 'k' for branching factors when constant
7. Compare the derived complexity to the expected optimal complexity.
8. Output ONLY a JSON object in this exact format:

{
  "derived_complexity": "O(...)",
  "verdict": "PASS" | "FAIL"
}

Critical Rules:
- When a loop contains a recursive call, treat each loop iteration as a separate branch in the recursion tree.
- If maxIterations = amount/coin[i] and this drives recursion, the branching factor includes 'amount'.
- Without memoization, recursion with variable branching creates exponential complexity.
- WITH memoization/DP: time = (number of unique states) × (work per state).
- WITHOUT memoization: time = (branching factor)^(recursion depth).
- Do not conflate additive parameters unless nested iterations create dependency.
- Use parameter names that match the problem: 'n' for length, 'S' or 'amount' for capacity/sum.
- Ignore constant factors and lower-order terms.
- If derived complexity is asymptotically equal to or better than expected, verdict = "PASS".
- Otherwise, verdict = "FAIL".
- Never include reasoning or explanations; only output the JSON object.`;

export interface ComplexityAnalysisResult {
  derived_complexity: string;
  verdict: 'PASS' | 'FAIL';
}

export async function analyzeTimeComplexity(
  code: string,
  expectedComplexity: string
): Promise<ComplexityAnalysisResult> {
  try {
    const userPrompt = `Code:
${code}

Expected time complexity: ${expectedComplexity}`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.1, // Low temperature for consistent analysis
    });

    const content = completion.choices[0].message.content;
    if (!content) {
      throw new Error('OpenAI returned empty response');
    }

    const result = JSON.parse(content) as ComplexityAnalysisResult;
    
    // Validate the response format
    if (!result.derived_complexity || !result.verdict) {
      throw new Error('Invalid response format from OpenAI');
    }

    if (result.verdict !== 'PASS' && result.verdict !== 'FAIL') {
      throw new Error('Invalid verdict value');
    }

    return result;
  } catch (error) {
    console.error('Error analyzing time complexity:', error);
    throw error;
  }
}

