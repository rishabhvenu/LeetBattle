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
2. Identify the input size parameter(s).
3. Determine how the algorithm's work grows with input size by:
   - Deriving a recurrence relation T(n) when recursion or divide-and-conquer is present.
   - Analyzing nested loops or iterations for iterative code.
4. Solve or simplify the recurrence (or equivalent loop work) to find the asymptotic runtime.
5. Express the result in Big-O notation.
6. Compare the derived complexity to the expected optimal complexity provided by the user.
7. Output ONLY a JSON object in this exact format:

{
  "derived_complexity": "O(...)",
  "verdict": "PASS" | "FAIL"
}

Rules:
- Use recurrence relations or loop analysis explicitly to determine T(n) before concluding.
- If the derived complexity is asymptotically equal to or better (lower) than the expected complexity, verdict = "PASS".
- Otherwise, verdict = "FAIL".
- Ignore constant factors and lower-order terms.
- Do NOT include reasoning, explanations, or extra text — only the JSON object.`;

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

