/**
 * Time Complexity Analyzer
 * Uses OpenAI GPT-5 with reasoning to analyze code time complexity
 */

import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const SYSTEM_PROMPT = `You are a rigorous algorithm complexity analyst. Your job is to derive the exact Big-O time complexity of submitted code and compare it against a target complexity.

**Analysis Framework:**

1. **Identify input variables**: What are the sizes that affect runtime? (n = array length, m = rows, k = distinct values, target/amount for DP problems, etc.)

2. **Trace execution flow**:
   - For loops: count iterations in terms of input variables
   - For recursion WITHOUT memoization: model as a tree — branching factor × depth = total calls
   - For recursion WITH memoization/DP: count unique subproblems × work per subproblem
   - For nested structures: multiply if independent, don't double-count shared work

3. **Common patterns to recognize**:
   - Two-pointer / sliding window on array: O(n)
   - Binary search: O(log n)
   - Sorting then linear scan: O(n log n)
   - Naive recursion (fibonacci-style): O(2^n) or O(k^n) depending on branching
   - DP with 2D table: O(n × m) or O(n × target)
   - Backtracking with pruning: analyze actual branches taken, not worst case unless no pruning

4. **Decision rule**:
   - PASS: derived complexity is asymptotically ≤ expected (e.g., O(n) vs expected O(n log n) → PASS)
   - FAIL: derived complexity is asymptotically > expected (e.g., O(2^n) vs expected O(n²) → FAIL)

**Output format (JSON only, no markdown):**
{"derived_complexity": "O(...)", "verdict": "PASS" | "FAIL"}`;

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
      model: 'gpt-5',
      reasoning_effort: 'high',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      response_format: { type: 'json_object' },
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

