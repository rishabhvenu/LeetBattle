
import { load as loadHtml, CheerioAPI } from 'cheerio';
import type { SpecialInputConfig } from '@/types/db';

export const PROBLEM_REWRITE_PROMPT = `You rewrite coding interview problems while preserving their exact algorithmic meaning.

Input JSON includes: { title, description, examples, constraints }.

Return ONLY a JSON object with keys:
- title
- topics (optional string[])
- description
- examples: array of { input, output, explanation | null }
- constraints
- signature: { functionName, parameters[{name,type}], returnType }
- specialInputs (optional)

Strict rules:
1. Preserve the original algorithm and requirements exactly (do not change difficulty, input/output behavior, or what is being asked).
2. Paraphrase ALL natural-language text (title, description, example explanations, and constraints). Do NOT copy any phrase longer than 5 consecutive words from the input. Use different wording and sentence structures while keeping semantics identical.
3. All examples MUST be correct, internally consistent, and match the signature types using JSON-like literals only.
4. Only allowed data structures: primitives, primitive arrays, ListNode, TreeNode, ListNode[], TreeNode[]. Assume these helpers already exist.
5. Emit specialInputs ONLY when the runner requires setup (e.g., linked-list cycle).
6. The returned JSON must be valid and contain no comments or extra text.

Deterministic output rule (MANDATORY):
For any problem where multiple outputs are logically valid (e.g., Two Sum), you MUST choose the canonical deterministic answer using this rule:
- Among all valid solutions, select the one whose output array is lexicographically smallest.
- For 2-Sum specifically: choose the valid pair with the smallest first index; if there is a tie, choose the one with the smallest second index.

HARD ENFORCEMENT:
The deterministic canonical answer rule is a HARD VALIDATION REQUIREMENT.
Any output that does NOT follow this canonical rule is INVALID and MUST NOT be produced.
You are NOT ALLOWED to return any other valid output, even if technically correct.`;

export const PROBLEM_ARTIFACT_PROMPT = `You generate reference solutions and deterministic test cases for coding interview problems.

Input JSON: {
  problem,
  languages[],
  numTestCases,
  maxInputSizeHint,
  targetTimeComplexity
}

Return ONLY a JSON object with:
- solutions: map from language -> complete Solution class
- testCases: array of { input, output, optional specialInputData }
- specialInputs (optional)

Strict rules:
1. All solutions must strictly follow the intended algorithmic logic of the problem and must pass every generated test case.
2. The problem's constraints are HARD REQUIREMENTS. Every solution MUST respect all constraints (input sizes, value ranges, structure rules, and complexity limits).
3. Test cases must be VALID, SMALL, and cover all required edge cases:
   - minimum-size inputs allowed by constraints
   - maximum-size inputs allowed by constraints (within maxInputSizeHint)
   - boundary values from constraints
   - duplicates, negatives, empty structures when allowed
   - cases requiring uniquely deterministic output (e.g., 2-Sum)
4. Every test case MUST have a single correct expected output. If multiple outputs are logically valid, choose ONE deterministically.
5. All inputs and outputs MUST use JSON-like literals exactly matching the signature.
6. Never define ListNode or TreeNode; assume they exist.
7. Special input metadata:
   - Any extra information needed to construct the runtime input (such as cycle positions, graph wiring, or flags)
     MUST appear as structured JSON, not only in natural-language text.
   - Prefer to encode such metadata directly inside the \`input\` object when it is part of the logical input.
   - When a special input config exists, you MAY also mirror this under \`specialInputData\` using the config id.
8. No commentary or explanation outside of the JSON.

Deterministic output rule (MANDATORY):
For any problem where multiple outputs are logically valid (e.g., Two Sum), you MUST choose the canonical deterministic answer using this rule:
- Among all valid solutions, select the one whose output array is lexicographically smallest.
- For 2-Sum specifically: choose the valid pair with the smallest first index; if there is a tie, choose the one with the smallest second index.

HARD ENFORCEMENT:
The deterministic canonical answer rule is a HARD VALIDATION REQUIREMENT.
Any output that does NOT follow this canonical rule is INVALID and MUST NOT be produced.
You are NOT ALLOWED to return any other valid output, even if technically correct.`;

export const GENERATION_LANGUAGES: Array<'python' | 'javascript' | 'java' | 'cpp'> = ['python', 'javascript', 'java', 'cpp'];

export interface GeneratedProblemPayload {
  title: string;
  topics?: string[];
  description: string;
  examples: Array<{ input: string; output: string; explanation: string | null }>;
  constraints: string[];
  signature: {
    functionName: string;
    parameters: Array<{ name: string; type: string }>;
    returnType: string;
  };
  specialInputs?: SpecialInputConfig[];
}

export interface GeneratedArtifacts {
  solutions?: Partial<Record<'python' | 'javascript' | 'js' | 'java' | 'cpp', string>>;
  testCases?: Array<{
    input: Record<string, unknown>;
    output: unknown;
    specialInputData?: Record<string, Record<string, unknown>>;
  }>;
  specialInputs?: SpecialInputConfig[];
}

export type LeetCodeAutofillExample = {
  input: string;
  output: string;
  explanation: string;
};

export type LeetCodeAutofillDetails = {
  title: string;
  difficulty: 'Easy' | 'Medium' | 'Hard';
  description: string;
  constraints: string[];
  examples: LeetCodeAutofillExample[];
};

export const LEETCODE_GRAPHQL_ENDPOINT = 'https://leetcode.com/graphql';
export const LEETCODE_GRAPHQL_QUERY = `
  query questionContent($titleSlug: String!) {
    question(titleSlug: $titleSlug) {
      title
      difficulty
      content
      exampleTestcases
      exampleTestcaseList
    }
  }
`;

export type NormalizedSolutionLanguage = 'python' | 'js' | 'java' | 'cpp';
export type NormalizedSolutionsMap = Partial<Record<NormalizedSolutionLanguage, string>>;

export function addSpecialInputConfig(
  existing: SpecialInputConfig[] | undefined,
  config: SpecialInputConfig
): SpecialInputConfig[] {
  const list = existing ? [...existing] : [];
  if (!list.some((item) => item.id === config.id)) {
    list.push(config);
  }
  return list;
}

export function sanitizeSpecialInputData(
  data: Record<string, unknown>
): Record<string, Record<string, unknown>> | undefined {
  if (!data || typeof data !== 'object') {
    return undefined;
  }
 
  const cleanedEntries = Object.entries(data)
    .map(([key, value]) => {
      if (!value || typeof value !== 'object') {
        return null;
      }
      const recordValue = value as Record<string, unknown>;
      if (Object.keys(recordValue).length === 0) {
        return null;
      }
      return [key, recordValue] as [string, Record<string, unknown>];
    })
    .filter((entry): entry is [string, Record<string, unknown>] => Boolean(entry));
 
  if (cleanedEntries.length === 0) {
    return undefined;
  }
 
  return Object.fromEntries(cleanedEntries);
}

export function normalizeListNodeInput(rawInput: unknown): Record<string, unknown> | undefined {
  if (!rawInput) {
    return undefined;
  }

  if (typeof rawInput === 'string') {
    const parsed = parseListNodeInputString(rawInput);
    return parsed ?? undefined;
  }

  if (typeof rawInput === 'object') {
    return rawInput as Record<string, unknown>;
  }

  return undefined;
}

export function parseListNodeInputString(raw: string): Record<string, unknown> | null {
  const headMatch = raw.match(/head\s*=\s*(\[[^\]]*\])/i);
  if (!headMatch) {
    return null;
  }

  const posMatch = raw.match(/pos\s*=\s*(-?\d+)/i);

  try {
    const head = JSON.parse(headMatch[1]);
    const result: Record<string, unknown> = { head };
    if (posMatch) {
      result.pos = Number(posMatch[1]);
    }
    return result;
  } catch {
    return null;
  }
}

export function replaceLinkedListCycleConfig(
  configs: SpecialInputConfig[] | undefined,
  parameter: string,
  nextConfig: SpecialInputConfig
): SpecialInputConfig[] {
  if (!configs) {
    return [];
  }

  return configs.map(config => {
    if (config.type === 'linked_list_cycle' && config.targets.some(target => target.parameter === parameter)) {
      return {
        ...config,
        targets: config.targets.map(target =>
          target.parameter === parameter ? { ...target, ...nextConfig.targets[0] } : target
        ),
      };
    }
    return config;
  });
}

export function applyLinkedListCycleMetadata({
  generatedProblem,
  artifacts,
}: {
  generatedProblem: GeneratedProblemPayload;
  artifacts: GeneratedArtifacts;
}) {
  const signature = generatedProblem.signature;
  if (!signature || !Array.isArray(signature.parameters) || signature.parameters.length === 0) {
    return;
  }

  const listNodeParam = signature.parameters.find((param) => param.type === 'ListNode');
  if (!listNodeParam) {
    return;
  }

  const parameterNames = new Set(signature.parameters.map((param) => param.name));

  const combinedConfigs: SpecialInputConfig[] = [
    ...(generatedProblem.specialInputs ?? []),
    ...(artifacts.specialInputs ?? []),
  ];

  const configId = `linked_list_cycle:${listNodeParam.name}`;
  let cycleConfig = combinedConfigs.find(
    (config) =>
      config.type === 'linked_list_cycle' &&
      Array.isArray(config.targets) &&
      config.targets.some((target) => target.parameter === listNodeParam.name)
  );

  let detectedMetadata = false;

  if (!Array.isArray(artifacts.testCases)) {
    if (cycleConfig) {
      generatedProblem.specialInputs = addSpecialInputConfig(generatedProblem.specialInputs, cycleConfig);
      artifacts.specialInputs = addSpecialInputConfig(artifacts.specialInputs, cycleConfig);
    }
    return;
  }

  artifacts.testCases.forEach((testCase) => {
    if (!testCase || typeof testCase !== 'object') {
      return;
    }

    const normalizedInput = normalizeListNodeInput(testCase.input);
    if (normalizedInput) {
      testCase.input = normalizedInput;
    }

    const input = testCase.input as Record<string, unknown> | undefined;
    if (!input || typeof input !== 'object') {
      return;
    }

    const existingSpecialInputData =
      testCase.specialInputData && typeof testCase.specialInputData === 'object'
        ? { ...(testCase.specialInputData as Record<string, unknown>) }
        : {};
    delete (existingSpecialInputData as Record<string, unknown>).cycleIndex;
    delete (existingSpecialInputData as Record<string, unknown>)[listNodeParam.name];

    let cycleIndexValue: number | null = null;
    const rawPos = (input as Record<string, unknown>)['pos'];
    if (typeof rawPos === 'number' && !parameterNames.has('pos')) {
      cycleIndexValue = Number(rawPos);
      delete (input as Record<string, unknown>)['pos'];
    }

    const rawCycleIndex = (input as Record<string, unknown>)['cycleIndex'];
    if (typeof rawCycleIndex === 'number' && !parameterNames.has('cycleIndex')) {
      if (cycleIndexValue === null) {
        cycleIndexValue = Number(rawCycleIndex);
      }
      delete (input as Record<string, unknown>)['cycleIndex'];
    }

    const existingConfigData =
      cycleConfig && existingSpecialInputData && typeof existingSpecialInputData[cycleConfig.id] === 'object'
        ? { ...(existingSpecialInputData[cycleConfig.id] as Record<string, unknown>) }
        : undefined;

    if (cycleConfig && existingConfigData && typeof existingConfigData === 'object' && 'cycleIndex' in existingConfigData) {
      detectedMetadata = true;
      if (cycleIndexValue === null) {
        // Preserve existing metadata if present and no new override provided
        cycleIndexValue = parseInt(String(existingConfigData.cycleIndex), 10);
      }
    }

    if (cycleIndexValue === null) {
      if (cycleConfig) {
        delete (existingSpecialInputData as Record<string, unknown>)[cycleConfig.id];
      }
      const sanitized = sanitizeSpecialInputData(existingSpecialInputData);
      testCase.specialInputData = sanitized;
      return;
    }

    detectedMetadata = true;

    if (cycleIndexValue >= 0) {
      if (!cycleConfig) {
        cycleConfig = {
          id: configId,
          type: 'linked_list_cycle',
          label: `Attach cycle to ${listNodeParam.name}`,
          targets: [{ parameter: listNodeParam.name, role: 'input' }],
        };
      } else if (cycleConfig.id !== configId) {
        cycleConfig = {
          ...cycleConfig,
          id: configId,
          targets: cycleConfig.targets ?? [{ parameter: listNodeParam.name, role: 'input' }],
        };
      }

      const updatedData = {
        ...existingSpecialInputData,
        [configId]: { cycleIndex: cycleIndexValue },
      };
      testCase.specialInputData = sanitizeSpecialInputData(updatedData);
    } else if (cycleConfig) {
      delete (existingSpecialInputData as Record<string, unknown>)[configId];
      testCase.specialInputData = sanitizeSpecialInputData(existingSpecialInputData);
    }
  });

  if (!cycleConfig || !detectedMetadata) {
    return;
  }

  generatedProblem.specialInputs = addSpecialInputConfig(generatedProblem.specialInputs, cycleConfig);
  artifacts.specialInputs = addSpecialInputConfig(artifacts.specialInputs, cycleConfig);
}

export function sanitizeMultiline(value: string | null | undefined): string {
  if (!value) {
    return '';
  }
  return value
    .replace(/\r/g, '')
    .replace(/\u00A0/g, ' ')
    .replace(/\t/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function normalizeDifficulty(raw: string | null | undefined): 'Easy' | 'Medium' | 'Hard' {
  if (!raw) {
    return 'Medium';
  }
  const normalized = raw.toLowerCase();
  if (normalized === 'easy' || normalized === 'medium' || normalized === 'hard') {
    return (raw[0].toUpperCase() + raw.slice(1).toLowerCase()) as 'Easy' | 'Medium' | 'Hard';
  }
  return 'Medium';
}

export function serializeElementText($: CheerioAPI, element: any): string {
  if (element.type === 'text') {
    return sanitizeMultiline(element.data ?? '');
  }

  if (element.type === 'tag') {
    const tagName = element.name.toLowerCase();

    if (tagName === 'sup') {
      const inner = $(element)
        .contents()
        .map((_, child) => serializeElementText($, child))
        .get()
        .join('');
      return inner ? `^${inner}` : '';
    }

    if (tagName === 'sub') {
      const inner = $(element)
        .contents()
        .map((_, child) => serializeElementText($, child))
        .get()
        .join('');
      return inner ? `_${inner}` : '';
    }

    if (tagName === 'code' || tagName === 'pre') {
      const inner = $(element)
        .contents()
        .map((_, child) => serializeElementText($, child))
        .get()
        .join('');
      return inner;
    }

    if (tagName === 'br') {
      return '\n';
    }

    // For other elements, join contents with spaces to preserve spacing
    const parts: string[] = [];
    const children = $(element).contents().toArray();
    
    children.forEach((child, idx) => {
      const serialized = serializeElementText($, child);
      if (serialized) {
        const isInline = child.type === 'tag' && child.name && ['code', 'sup', 'sub', 'strong', 'em', 'b', 'i'].includes(child.name.toLowerCase());
        
        // Add space before inline elements if previous part doesn't end with space/punctuation
        if (parts.length > 0) {
          const lastPart = parts[parts.length - 1];
          if (isInline && lastPart && !/[ \t\n.,;:!?)$\]}]$/.test(lastPart)) {
            parts.push(' ');
          }
        }
        
        parts.push(serialized);
        
        // Add space after inline elements (especially code) if next sibling is text starting with letter
        // This handles cases like "<code>pos</code>is" -> "pos is" or "10^5pos" -> "10^5 pos"
        if (isInline && idx < children.length - 1) {
          const nextChild = children[idx + 1];
          if (nextChild && nextChild.type === 'text' && nextChild.data) {
            const nextText = nextChild.data;
            // If next text starts with a letter (after any leading whitespace) and current doesn't end with space/punctuation
            const firstChar = nextText.trim()[0];
            if (firstChar && /[a-zA-Z]/.test(firstChar) && !/[ \t\n.,;:!?)$\]}]$/.test(serialized)) {
              // Only add space if there isn't already whitespace between them
              if (!nextText.startsWith(' ') && !nextText.startsWith('\t') && !nextText.startsWith('\n')) {
                parts.push(' ');
              }
            }
          }
        }
      }
    });
    
    return parts.join('');
  }

  return '';
}

export function loadPreparedLeetCodeDom(content: string): CheerioAPI {
  const $ = loadHtml(content);

  $('script, style').remove();

  $('*').each((_, element) => {
    const serialized = serializeElementText($, element);
    if (serialized !== undefined) {
      $(element).text(serialized);
    }
  });

  return $;
}

export function extractPlainText(content: string): string {
  const $ = loadPreparedLeetCodeDom(content);
  const segments: string[] = [];

  $('body')
    .find('h1, h2, h3, h4, h5, h6, p, li, pre')
    .each((_, element) => {
      const text = $(element).text().trim();
      if (text) {
        segments.push(text);
      }
    });

  if (segments.length === 0) {
    const fallback = $.root().text().trim();
    return sanitizeMultiline(fallback);
  }

  return sanitizeMultiline(segments.join('\n'));
}

export function extractConstraints(content: string): string[] {
  // Load DOM without serializing first, so we can extract list structure
  const $ = loadHtml(content);
  $('script, style').remove();
  
  const constraints: string[] = [];

  // Find the "Constraints" heading
  const heading = $('strong')
    .filter((_, element) => $(element).text().trim().toLowerCase().startsWith('constraints'))
    .first();

  if (!heading.length) {
    return constraints;
  }

  // Find the <ul> or <ol> element - try multiple approaches
  let listElement = heading.next('ul, ol');
  
  if (!listElement.length) {
    listElement = heading.parent().next('ul, ol');
  }
  
  if (!listElement.length) {
    const container = heading.closest('p, div');
    if (container.length) {
      listElement = container.next('ul, ol');
    }
  }
  
  if (!listElement.length) {
    // Search siblings after the heading
    let current = heading.next();
    while (current.length) {
      if (current.is('ul, ol')) {
        listElement = current;
        break;
      }
      current = current.next();
    }
  }
  
  // Extract each <li> as a separate constraint
  // Serialize each <li> individually to preserve spacing
  if (listElement.length) {
    listElement.find('li').each((_, li) => {
      // Serialize this specific <li> element to get properly formatted text
      const serialized = serializeElementText($, li);
      if (serialized) {
        const text = sanitizeMultiline(serialized);
        if (text) {
          constraints.push(text);
        }
      }
    });
  }

  return constraints;
}

export function extractConstraintsFromPlainText(fullText: string): string[] {
  const constraintSection = fullText.split(/Constraints:/i)[1];
  if (!constraintSection) {
    return [];
  }

  const untilExamples =
    constraintSection.split(/Example\s+\d+:/i)[0]?.split(/Follow\s*up:/i)[0] ?? constraintSection;

  const splitConstraintText = (text: string): string[] => {
    // PRIORITY: Split by bullet points FIRST - this is the most reliable indicator
    // Bullet points can appear at start of line, after periods, or anywhere
    const bulletSplit = text.split(/(?:^|\.\s*|\n)\s*[•\-\*]\s+/m).filter(s => s.trim());
    if (bulletSplit.length > 1) {
      return bulletSplit.map(s => s.trim()).filter(s => s);
    }
    
    // Also try splitting on bullet points anywhere in the text (more permissive)
    const bulletSplitAnywhere = text.split(/[•\-\*]\s+/).filter(s => s.trim());
    if (bulletSplitAnywhere.length > 1) {
      return bulletSplitAnywhere.map(s => s.trim()).filter(s => s);
    }
    
    // If no bullet points found, try to fix spacing issues that might prevent proper splitting
    // Fix patterns like "10^5posis" -> "10^5 posis", "-1or" -> "-1 or", "indexin" -> "index in"
    const normalized = text
      // Fix: number/exponent followed by lowercase word (like "10^5posis" or "10^4].")
      .replace(/(\d+\^?\d*[\]\)]?)([a-z])/g, '$1 $2')
      // Fix: negative number followed by lowercase word (like "-1or")
      .replace(/(-\d+)([a-z])/g, '$1 $2')
      // Fix: common programming/constraint words that might be concatenated
      // Match patterns like "posis" (pos + is), "indexin" (index + in), etc.
      // Note: no word boundary between the words since they're concatenated
      .replace(/\b(pos)(is|or|in|a|an|the|of|to|for|and|but|if|at|on|by|as|be|do|go|no|so|up|we|val)([^a-z]|$)/gi, '$1 $2$3')
      .replace(/\b(index)(is|or|in|a|an|the|of|to|for|and|but|if|at|on|by|as|be|do|go|no|so|up|we|val)([^a-z]|$)/gi, '$1 $2$3')
      .replace(/\b(valid)(is|or|in|a|an|the|of|to|for|and|but|if|at|on|by|as|be|do|go|no|so|up|we|val|index)([^a-z]|$)/gi, '$1 $2$3')
      // Fix: word ending followed by common short words (is, or, in, a, an, the, of, to, for, and, but, if, at, on, by, as, be, do, go, no, so, up, we)
      .replace(/([a-z]{3,})(is|or|in|a|an|the|of|to|for|and|but|if|at|on|by|as|be|do|go|no|so|up|we)([^a-z]|$)/gi, '$1 $2$3');
    
    // Try splitting by bullet points again after normalization (in case they were hidden)
    const normalizedBulletSplit = normalized.split(/[•\-\*]\s+/).filter(s => s.trim());
    if (normalizedBulletSplit.length > 1) {
      return normalizedBulletSplit.map(s => s.trim()).filter(s => s);
    }
    
    // Try splitting by numbered patterns (1., 2., etc.)
    const numberedSplit = normalized.split(/\d+\.\s+/).filter(s => s.trim());
    if (numberedSplit.length > 1) {
      return numberedSplit.map(s => s.trim()).filter(s => s);
    }
    
    // Try splitting by periods followed by dash/number (with or without space)
    // Pattern: period, optional space, dash, number (like ". -10^5" or ".-10^5")
    const periodDashSplit = normalized.split(/\.\s*(?=[\-0-9])/).filter(s => s.trim());
    if (periodDashSplit.length > 1) {
      const result: string[] = [];
      periodDashSplit.forEach((part, idx) => {
        const trimmed = part.trim();
        if (trimmed) {
          // Add period back to all but the last part if it doesn't already have one
          if (idx < periodDashSplit.length - 1 && !trimmed.endsWith('.')) {
            result.push(trimmed + '.');
          } else {
            result.push(trimmed);
          }
        }
      });
      if (result.length > 1) {
        return result;
      }
    }
    
    // Try splitting on constraint boundaries: number/range ending followed by constraint keyword
    // Pattern: ends with number/range (like "10^5" or "10^4].") followed by constraint keywords (pos, index, valid, etc.)
    // This handles cases like "10^5 pos is" -> split before "pos"
    // Use a special delimiter to mark the split point, then split on it
    const withDelimiter = normalized.replace(/(\d+\^?\d*[\]\)]?\s+)(?=\b(pos|index|valid|node|list|range|number|value|constraint|parameter|input|output|the|a|an)\s+)/i, '|||SPLIT|||');
    if (withDelimiter !== normalized) {
      const split = withDelimiter.split('|||SPLIT|||').filter(s => s.trim());
      if (split.length > 1) {
        return split.map(s => s.trim()).filter(s => s);
      }
    }
    
    // Try splitting by periods followed by capital letters (new sentence)
    // Only if the period is at the end of a word (not in the middle like "Node.val")
    const periodSplit = normalized.split(/\.\s+(?=[A-Z][a-z])/).filter(s => s.trim());
    if (periodSplit.length > 1) {
      return periodSplit.map(s => s.trim() + (s.endsWith('.') ? '' : '.')).filter(s => s);
    }
    
    // Try splitting by single newlines if they look like separate constraints
    const newlineSplit = normalized.split(/\n+/).filter(s => s.trim());
    if (newlineSplit.length > 1) {
      return newlineSplit.map(s => s.trim()).filter(s => s);
    }
    
    return [text];
  };

  // Try multiple splitting strategies
  let constraints: string[] = [];
  
  // Strategy 1: Split by newlines first (most common in plain text)
  const newlineSplit = untilExamples.split(/\n+/).map(line => line.trim()).filter(line => line.length > 0);
  if (newlineSplit.length > 1) {
    constraints = newlineSplit
      .map(line => line.replace(/^[\s•*\-]+/, '').trim()) // Remove leading bullet characters
      .filter(s => s && !/^Constraints$/i.test(s));
    if (constraints.length > 1) {
      return constraints;
    }
  }
  
  // Strategy 2: Split by bullet points (with or without space after)
  // Try various bullet characters: •, -, *, and also look for patterns like "- " or "• "
  const bulletPatterns = [
    /[•]\s*/g,  // Bullet character with optional space
    /^[\s]*[-]\s+/gm,  // Dash at start of line with space
    /[\s]+[-]\s+/g,  // Dash with spaces around it
    /[*]\s+/g,  // Asterisk with space
  ];
  
  for (const pattern of bulletPatterns) {
    const bulletSplit = untilExamples.split(pattern).filter(s => s.trim());
    if (bulletSplit.length > 1) {
      constraints = bulletSplit
        .map(s => s.trim())
        .filter(s => s && !/^Constraints$/i.test(s) && s.length > 0);
      if (constraints.length > 1) {
        return constraints;
      }
    }
  }
  
  // Strategy 3: Split by numbered patterns (1., 2., etc.)
  const numberedSplit = untilExamples.split(/\d+\.\s+/).filter(s => s.trim());
  if (numberedSplit.length > 1) {
    constraints = numberedSplit.map(s => s.trim()).filter(s => s && !/^Constraints$/i.test(s));
    if (constraints.length > 1) {
      return constraints;
    }
  }
  
  // Strategy 4: Use the improved split function
  constraints = splitConstraintText(untilExamples)
    .filter(s => s && !/^Constraints$/i.test(s));
  
  if (constraints.length > 1) {
    return constraints;
  }
  
  // Strategy 5: Final fallback - return as single constraint if nothing else works
  const trimmed = untilExamples.trim();
  if (trimmed && !/^Constraints$/i.test(trimmed)) {
    return [trimmed];
  }
  
  return [];
}

export function extractExamples(fullText: string): LeetCodeAutofillExample[] {
  const sections = fullText.split(/Example\s+\d+:/i).slice(1);
  const examples: LeetCodeAutofillExample[] = [];

  for (const rawSection of sections) {
    const section = rawSection.trim();
    if (!section) {
      continue;
    }

    const inputMatch = section.match(/Input:\s*([\s\S]*?)(?=Output:|Explanation:|Example\s+\d+:|Constraints:|$)/i);
    const outputMatch = section.match(/Output:\s*([\s\S]*?)(?=Explanation:|Example\s+\d+:|Constraints:|$)/i);
    const explanationMatch = section.match(/Explanation:\s*([\s\S]*?)(?=Example\s+\d+:|Constraints:|$)/i);

    const input = sanitizeMultiline(inputMatch?.[1] ?? '');
    const output = sanitizeMultiline(outputMatch?.[1] ?? '');
    const explanation = sanitizeMultiline(explanationMatch?.[1] ?? '');

    if (input || output || explanation) {
      examples.push({
        input,
        output,
        explanation,
      });
    }
  }

  return examples;
}

export function buildLeetCodeDetails(question: {
  title?: string;
  difficulty?: string;
  content?: string;
  exampleTestcases?: string | null;
  exampleTestcaseList?: string[] | null;
}): LeetCodeAutofillDetails | null {
  if (!question || !question.content) {
    return null;
  }

  const plainText = extractPlainText(question.content);
  const descriptionCutIndex = Math.min(
    ...[
      plainText.search(/Constraints:/i),
      plainText.search(/Example\s+\d+:/i),
      plainText.search(/Follow\s*up:/i),
    ].filter(index => index >= 0)
  );

  let descriptionText = plainText;
  if (descriptionCutIndex !== Infinity) {
    descriptionText = plainText.slice(0, descriptionCutIndex);
  }

  let constraints = extractConstraints(question.content);
  if (constraints.length === 0) {
    constraints = extractConstraintsFromPlainText(plainText);
  }
  const examples = extractExamples(plainText);

  if (examples.length === 0 && question.exampleTestcases) {
    const fallbackInput = sanitizeMultiline(question.exampleTestcases);
    if (fallbackInput) {
      examples.push({
        input: fallbackInput,
        output: '',
        explanation: '',
      });
    }
  }

  if (examples.length === 0 && Array.isArray(question.exampleTestcaseList) && question.exampleTestcaseList.length > 0) {
    const fallbackInput = sanitizeMultiline(question.exampleTestcaseList[0]);
    if (fallbackInput) {
      examples.push({
        input: fallbackInput,
        output: '',
        explanation: '',
      });
    }
  }

  if (examples.length === 0) {
    examples.push({
      input: '',
      output: '',
      explanation: '',
    });
  }

  return {
    title: sanitizeMultiline(question.title ?? ''),
    difficulty: normalizeDifficulty(question.difficulty),
    description: sanitizeMultiline(descriptionText),
    constraints,
    examples,
  };
}

export function normalizeTestCaseOutputByReturnType(
  returnType: string | undefined,
  output: unknown
): unknown {
  if (!returnType) {
    return output;
  }

  const normalized = returnType.trim().toLowerCase();
  if (normalized === 'boolean') {
    if (typeof output === 'boolean') {
      return output;
    }
    if (typeof output === 'string') {
      const lower = output.trim().toLowerCase();
      if (lower === 'true') return true;
      if (lower === 'false') return false;
    }
    if (typeof output === 'number') {
      if (Number.isFinite(output)) {
        if (output === 1) return true;
        if (output === 0) return false;
      }
    }
  }

  return output;
}

export function normalizeArtifactSolutions(
  solutions?: Partial<Record<'python' | 'javascript' | 'js' | 'java' | 'cpp', unknown>>
): NormalizedSolutionsMap {
  if (!solutions || typeof solutions !== 'object') {
    return {};
  }

  const normalized: NormalizedSolutionsMap = {};
  const candidates: Array<{ sources: Array<'python' | 'javascript' | 'js' | 'java' | 'cpp'>; target: NormalizedSolutionLanguage }> = [
    { sources: ['python'], target: 'python' },
    { sources: ['javascript', 'js'], target: 'js' },
    { sources: ['java'], target: 'java' },
    { sources: ['cpp'], target: 'cpp' },
  ];

  for (const mapping of candidates) {
    for (const source of mapping.sources) {
      const candidate = solutions[source];
      if (typeof candidate === 'string') {
        const trimmed = candidate.trim();
        if (trimmed.length > 0) {
          normalized[mapping.target] = trimmed;
          break;
        }
      }
    }
  }

  return normalized;
}
