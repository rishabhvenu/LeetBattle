/**
 * Code Runner Module
 * Generates runnable code by wrapping Solution classes with test harness
 */

interface FunctionSignature {
  functionName: string;
  parameters: Array<{ name: string; type: string }>;
  returnType: string;
}

interface TestCase {
  input: Record<string, unknown>;
  output: unknown;
}

/**
 * Generate Python runner code
 */
export function generatePythonRunner(
  solutionCode: string,
  signature: FunctionSignature,
  testInput: Record<string, unknown>
): string {
  const { functionName, parameters } = signature;
  
  // Build function call arguments from test input
  const args = parameters.map(param => `input_data["${param.name}"]`).join(', ');
  
  return `${solutionCode}

import json
import sys

# Test runner
if __name__ == "__main__":
    solution = Solution()
    input_data = ${JSON.stringify(testInput)}
    result = solution.${functionName}(${args})
    print(json.dumps(result))
`;
}

/**
 * Generate JavaScript runner code
 */
export function generateJavaScriptRunner(
  solutionCode: string,
  signature: FunctionSignature,
  testInput: Record<string, unknown>
): string {
  const { functionName, parameters } = signature;
  
  // Build function call arguments from test input
  const args = parameters.map(param => `input.${param.name}`).join(', ');
  
  return `${solutionCode}

// Test runner
const solution = new Solution();
const input = ${JSON.stringify(testInput)};
const result = solution.${functionName}(${args});
console.log(JSON.stringify(result));
`;
}

/**
 * Generate Java runner code
 */
export function generateJavaRunner(
  solutionCode: string,
  signature: FunctionSignature,
  testInput: Record<string, unknown>
): string {
  const { functionName, parameters, returnType } = signature;
  
  // Map type names to Java types
  const mapType = (type: string): string => {
    const typeMap: Record<string, string> = {
      'int[]': 'int[]',
      'string[]': 'String[]',
      'int': 'int',
      'string': 'String',
      'boolean': 'boolean',
      'double': 'double',
      'float': 'float',
      'long': 'long',
    };
    return typeMap[type.toLowerCase()] || type;
  };

  const javaReturnType = mapType(returnType);

  // Generate input parsing and function call
  const inputParsing = parameters.map((param, idx) => {
    const javaType = mapType(param.type);
    
    // Handle different types
    if (param.type.toLowerCase().includes('int[]')) {
      return `        int[] ${param.name} = parseIntArray(input.get("${param.name}"));`;
    } else if (param.type.toLowerCase().includes('string[]')) {
      return `        String[] ${param.name} = parseStringArray(input.get("${param.name}"));`;
    } else if (param.type.toLowerCase() === 'int') {
      return `        int ${param.name} = ((Number) input.get("${param.name}")).intValue();`;
    } else if (param.type.toLowerCase() === 'string') {
      return `        String ${param.name} = (String) input.get("${param.name}");`;
    } else if (param.type.toLowerCase() === 'boolean') {
      return `        boolean ${param.name} = (Boolean) input.get("${param.name}");`;
    }
    return `        ${javaType} ${param.name} = (${javaType}) input.get("${param.name}");`;
  }).join('\n');

  const args = parameters.map(param => param.name).join(', ');

  return `import com.google.gson.Gson;
import com.google.gson.reflect.TypeToken;
import java.util.*;

${solutionCode}

public class Main {
    public static void main(String[] args) {
        Gson gson = new Gson();
        String inputJson = ${JSON.stringify(JSON.stringify(testInput))};
        Map<String, Object> input = gson.fromJson(inputJson, new TypeToken<Map<String, Object>>(){}.getType());
        
${inputParsing}
        
        Solution solution = new Solution();
        ${javaReturnType} result = solution.${functionName}(${args});
        
        System.out.println(gson.toJson(result));
    }
    
    private static int[] parseIntArray(Object obj) {
        List<Number> list = (List<Number>) obj;
        int[] arr = new int[list.size()];
        for (int i = 0; i < list.size(); i++) {
            arr[i] = list.get(i).intValue();
        }
        return arr;
    }
    
    private static String[] parseStringArray(Object obj) {
        List<String> list = (List<String>) obj;
        return list.toArray(new String[0]);
    }
}
`;
}

/**
 * Generate C++ runner code
 */
export function generateCppRunner(
  solutionCode: string,
  signature: FunctionSignature,
  testInput: Record<string, unknown>
): string {
  const { functionName, parameters, returnType } = signature;
  
  // Map type names to C++ types
  const mapType = (type: string): string => {
    const typeMap: Record<string, string> = {
      'int[]': 'vector<int>',
      'string[]': 'vector<string>',
      'int': 'int',
      'string': 'string',
      'boolean': 'bool',
      'double': 'double',
      'float': 'float',
      'long': 'long',
    };
    return typeMap[type.toLowerCase()] || type;
  };

  const cppReturnType = mapType(returnType);

  // Generate input parsing
  const inputParsing = parameters.map((param, idx) => {
    const cppType = mapType(param.type);
    
    if (param.type.toLowerCase().includes('int[]')) {
      return `    vector<int> ${param.name} = input["${param.name}"].get<vector<int>>();`;
    } else if (param.type.toLowerCase().includes('string[]')) {
      return `    vector<string> ${param.name} = input["${param.name}"].get<vector<string>>();`;
    } else if (param.type.toLowerCase() === 'int') {
      return `    int ${param.name} = input["${param.name}"].get<int>();`;
    } else if (param.type.toLowerCase() === 'string') {
      return `    string ${param.name} = input["${param.name}"].get<string>();`;
    } else if (param.type.toLowerCase() === 'boolean') {
      return `    bool ${param.name} = input["${param.name}"].get<bool>();`;
    }
    return `    ${cppType} ${param.name} = input["${param.name}"].get<${cppType}>();`;
  }).join('\n');

  const args = parameters.map(param => param.name).join(', ');

  return `#include <iostream>
#include <vector>
#include <string>
#include <nlohmann/json.hpp>

using json = nlohmann::json;
using namespace std;

${solutionCode}

int main() {
    string input_str = R"(${JSON.stringify(testInput)})";
    json input = json::parse(input_str);
    
${inputParsing}
    
    Solution solution;
    ${cppReturnType} result = solution.${functionName}(${args});
    
    json output = result;
    cout << output.dump() << endl;
    
    return 0;
}
`;
}

/**
 * Main function to generate runnable code for any language
 */
export function generateRunnableCode(
  language: 'python' | 'javascript' | 'java' | 'cpp',
  solutionCode: string,
  signature: FunctionSignature,
  testInput: Record<string, unknown>
): string {
  switch (language) {
    case 'python':
      return generatePythonRunner(solutionCode, signature, testInput);
    case 'javascript':
      return generateJavaScriptRunner(solutionCode, signature, testInput);
    case 'java':
      return generateJavaRunner(solutionCode, signature, testInput);
    case 'cpp':
      return generateCppRunner(solutionCode, signature, testInput);
    default:
      throw new Error(`Unsupported language: ${language}`);
  }
}

/**
 * Generate batch Python runner code
 */
export function generateBatchPythonRunner(
  solutionCode: string,
  signature: FunctionSignature,
  testCases: Array<{ input: Record<string, unknown>; output: unknown }>
): string {
  const { functionName, parameters } = signature;
  
  return `${solutionCode}

import json
import sys

# Test runner
if __name__ == "__main__":
    solution = Solution()
    test_cases = ${JSON.stringify(testCases)}
    
    for i, test_case in enumerate(test_cases):
        input_data = test_case["input"]
        expected = test_case["output"]
        
        args = [input_data["${parameters[0].name}"]]
        ${parameters.slice(1).map(p => `args.append(input_data["${p.name}"])`).join('\n        ')}
        
        result = solution.${functionName}(*args)
        print(f"Test {i}: {json.dumps(result)}")
`;
}

/**
 * Generate batch JavaScript runner code
 */
export function generateBatchJavaScriptRunner(
  solutionCode: string,
  signature: FunctionSignature,
  testCases: Array<{ input: Record<string, unknown>; output: unknown }>
): string {
  const { functionName, parameters } = signature;
  
  return `${solutionCode}

const solution = new Solution();
const testCases = ${JSON.stringify(testCases)};

for (let i = 0; i < testCases.length; i++) {
    const testCase = testCases[i];
    const input = testCase.input;
    const expected = testCase.output;
    
    const result = solution.${functionName}(${parameters.map(p => `input.${p.name}`).join(', ')});
    console.log(\`Test \${i}: \${JSON.stringify(result)}\`);
}
`;
}

/**
 * Generate batch Java runner code
 */
export function generateBatchJavaRunner(
  solutionCode: string,
  signature: FunctionSignature,
  testCases: Array<{ input: Record<string, unknown>; output: unknown }>
): string {
  const { functionName, parameters } = signature;
  
  // Remove 'public' from Solution class to avoid filename conflicts
  const fixedSolutionCode = solutionCode.replace(/public\s+class\s+Solution/g, 'class Solution');
  
  // Generate hardcoded test cases since Java doesn't have easy JSON parsing in Judge0
  const testCode = testCases.map((testCase, index) => {
    const args = parameters.map(p => {
      const value = testCase.input[p.name];
      if (Array.isArray(value)) {
        return `new int[]{${value.join(', ')}}`;
      }
      return String(value);
    }).join(', ');
    
    return `        // Test ${index + 1}
        result = solution.${functionName}(${args});
        System.out.println("Test ${index}: " + java.util.Arrays.toString(result));`;
  }).join('\n');
  
  return `import java.util.*;
${fixedSolutionCode}

public class Main {
    public static void main(String[] args) {
        Solution solution = new Solution();
        int[] result;
        
${testCode}
    }
}
`;
}

/**
 * Generate batch C++ runner code
 */
export function generateBatchCppRunner(
  solutionCode: string,
  signature: FunctionSignature,
  testCases: Array<{ input: Record<string, unknown>; output: unknown }>
): string {
  const { functionName, parameters } = signature;
  
  // Generate hardcoded test cases - create variables first to avoid reference issues
  const testCode = testCases.map((testCase, index) => {
    // Create variables for array parameters to avoid binding rvalue to non-const reference
    const arrayVars = parameters
      .map((p, pIdx) => {
        const value = testCase.input[p.name];
        if (Array.isArray(value)) {
          return `    vector<int> test${index}_${p.name} = {${value.join(', ')}};`;
        }
        return null;
      })
      .filter(Boolean)
      .join('\n');
    
    const args = parameters.map(p => {
      const value = testCase.input[p.name];
      if (Array.isArray(value)) {
        return `test${index}_${p.name}`;
      }
      return String(value);
    }).join(', ');
    
    return `    // Test ${index + 1}
${arrayVars}
    result = solution.${functionName}(${args});
    cout << "Test ${index}: [";
    for (int i = 0; i < result.size(); i++) {
        cout << result[i];
        if (i < result.size() - 1) cout << ",";
    }
    cout << "]" << endl;`;
  }).join('\n');
  
  return `#include <iostream>
#include <vector>
#include <string>
#include <unordered_map>
using namespace std;

${solutionCode}

int main() {
    Solution solution;
    vector<int> result;
    
${testCode}
    
    return 0;
}
`;
}

/**
 * Generate batch runnable code for multiple test cases
 */
export function generateBatchRunnableCode(
  language: 'python' | 'javascript' | 'java' | 'cpp',
  solutionCode: string,
  signature: FunctionSignature,
  testCases: Array<{ input: Record<string, unknown>; output: unknown }>
): string {
  switch (language) {
    case 'python':
      return generateBatchPythonRunner(solutionCode, signature, testCases);
    case 'javascript':
      return generateBatchJavaScriptRunner(solutionCode, signature, testCases);
    case 'java':
      return generateBatchJavaRunner(solutionCode, signature, testCases);
    case 'cpp':
      return generateBatchCppRunner(solutionCode, signature, testCases);
    default:
      throw new Error(`Unsupported language: ${language}`);
  }
}

/**
 * Get Judge0 language ID for each language
 */
export function getJudge0LanguageId(language: string): number {
  const languageMap: Record<string, number> = {
    'python': 71,      // Python 3
    'javascript': 63,  // JavaScript (Node.js)
    'java': 62,        // Java
    'cpp': 54,         // C++ (GCC 9.2.0)
    'js': 63,          // Alias for javascript
  };
  
  const langId = languageMap[language.toLowerCase()];
  if (!langId) {
    throw new Error(`Unknown language: ${language}`);
  }
  return langId;
}

/**
 * Parse test result from stdout
 */
export function parseTestResult(stdout: string): unknown {
  try {
    return JSON.parse(stdout.trim());
  } catch (error) {
    throw new Error(`Failed to parse test output: ${stdout}`);
  }
}

/**
 * Compare expected output with actual output
 */
export function compareOutputs(expected: unknown, actual: unknown): boolean {
  return JSON.stringify(expected) === JSON.stringify(actual);
}

