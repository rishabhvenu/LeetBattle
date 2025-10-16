/**
 * Code Runner Module
 * Generates runnable code by wrapping Solution classes with test harness
 */

import { 
  hasComplexDataTypes, 
  getHelpersForLanguage, 
  isListNodeType, 
  isTreeNodeType 
} from './dataStructureHelpers';

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
  const { functionName, parameters, returnType } = signature;
  
  // Check if we need helper functions for complex data types
  const needsHelpers = hasComplexDataTypes(signature);
  const helpers = needsHelpers ? getHelpersForLanguage('python') : '';
  
  // Build function call arguments from test input with deserialization
  const args = parameters.map(param => {
    if (isListNodeType(param.type)) {
      return `deserialize_list(input_data["${param.name}"])`;
    } else if (isTreeNodeType(param.type)) {
      return `deserialize_tree(input_data["${param.name}"])`;
    } else {
      return `input_data["${param.name}"]`;
    }
  }).join(', ');
  
  // Handle output serialization
  let outputSerialization = 'result';
  if (isListNodeType(returnType)) {
    outputSerialization = 'serialize_list(result)';
  } else if (isTreeNodeType(returnType)) {
    outputSerialization = 'serialize_tree(result)';
  }
  
  return `${helpers}
${solutionCode}

import json
import sys

# Test runner
if __name__ == "__main__":
    solution = Solution()
    input_data = ${JSON.stringify(testInput)}
    result = solution.${functionName}(${args})
    print(json.dumps(${outputSerialization}))
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
  const { functionName, parameters, returnType } = signature;
  
  // Check if we need helper functions for complex data types
  const needsHelpers = hasComplexDataTypes(signature);
  const helpers = needsHelpers ? getHelpersForLanguage('javascript') : '';
  
  // Build function call arguments from test input with deserialization
  const args = parameters.map(param => {
    if (isListNodeType(param.type)) {
      return `deserializeList(input.${param.name})`;
    } else if (isTreeNodeType(param.type)) {
      return `deserializeTree(input.${param.name})`;
    } else {
      return `input.${param.name}`;
    }
  }).join(', ');
  
  // Handle output serialization
  let outputSerialization = 'result';
  if (isListNodeType(returnType)) {
    outputSerialization = 'serializeList(result)';
  } else if (isTreeNodeType(returnType)) {
    outputSerialization = 'serializeTree(result)';
  }
  
  return `${helpers}
${solutionCode}

// Test runner
const solution = new Solution();
const input = ${JSON.stringify(testInput)};
const result = solution.${functionName}(${args});
console.log(JSON.stringify(${outputSerialization}));
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
  
  // Check if we need helper functions for complex data types
  const needsHelpers = hasComplexDataTypes(signature);
  const helpers = needsHelpers ? getHelpersForLanguage('java') : '';
  
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
      'ListNode': 'ListNode',
      'TreeNode': 'TreeNode',
    };
    return typeMap[type.toLowerCase()] || type;
  };

  const javaReturnType = mapType(returnType);

  // Generate input parsing and function call
  const inputParsing = parameters.map((param, idx) => {
    const javaType = mapType(param.type);
    
    // Handle complex data types
    if (isListNodeType(param.type)) {
      return `        ListNode ${param.name} = ListHelper.deserializeList((List<Integer>) input.get("${param.name}"));`;
    } else if (isTreeNodeType(param.type)) {
      return `        TreeNode ${param.name} = TreeHelper.deserializeTree((List<Integer>) input.get("${param.name}"));`;
    }
    // Handle different primitive types
    else if (param.type.toLowerCase().includes('int[]')) {
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
  
  // Handle output serialization
  let outputSerialization = 'gson.toJson(result)';
  if (isListNodeType(returnType)) {
    outputSerialization = 'gson.toJson(ListHelper.serializeList(result))';
  } else if (isTreeNodeType(returnType)) {
    outputSerialization = 'gson.toJson(TreeHelper.serializeTree(result))';
  }

  return `import com.google.gson.Gson;
import com.google.gson.reflect.TypeToken;
import java.util.*;

${helpers}
${solutionCode}

public class Main {
    public static void main(String[] args) {
        Gson gson = new Gson();
        String inputJson = ${JSON.stringify(JSON.stringify(testInput))};
        Map<String, Object> input = gson.fromJson(inputJson, new TypeToken<Map<String, Object>>(){}.getType());
        
${inputParsing}
        
        Solution solution = new Solution();
        ${javaReturnType} result = solution.${functionName}(${args});
        
        System.out.println(${outputSerialization});
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
  
  // Check if we need helper functions for complex data types
  const needsHelpers = hasComplexDataTypes(signature);
  const helpers = needsHelpers ? getHelpersForLanguage('cpp') : '';
  
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
      'ListNode': 'ListNode*',
      'TreeNode': 'TreeNode*',
    };
    return typeMap[type.toLowerCase()] || type;
  };

  const cppReturnType = mapType(returnType);

  // Generate input parsing
  const inputParsing = parameters.map((param, idx) => {
    const cppType = mapType(param.type);
    
    // Handle complex data types
    if (isListNodeType(param.type)) {
      return `    ListNode* ${param.name} = deserializeList(input["${param.name}"].get<vector<int>>());`;
    } else if (isTreeNodeType(param.type)) {
      return `    TreeNode* ${param.name} = deserializeTree(input["${param.name}"].get<vector<int>>());`;
    }
    // Handle primitive types
    else if (param.type.toLowerCase().includes('int[]')) {
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
  
  // Handle output serialization
  let outputSerialization = 'result';
  if (isListNodeType(returnType)) {
    outputSerialization = 'serializeList(result)';
  } else if (isTreeNodeType(returnType)) {
    outputSerialization = 'serializeTree(result)';
  }

  return `#include <iostream>
#include <vector>
#include <string>
#include <queue>
#include <nlohmann/json.hpp>

using json = nlohmann::json;
using namespace std;

${helpers}
${solutionCode}

int main() {
    string input_str = R"(${JSON.stringify(testInput)})";
    json input = json::parse(input_str);
    
${inputParsing}
    
    Solution solution;
    ${cppReturnType} result = solution.${functionName}(${args});
    
    json output = ${outputSerialization};
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
  const { functionName, parameters, returnType } = signature;
  
  // Check if we need helper functions for complex data types
  const needsHelpers = hasComplexDataTypes(signature);
  const helpers = needsHelpers ? getHelpersForLanguage('python') : '';
  
  // Build argument deserialization
  const argsDeserialization = parameters.map(param => {
    if (isListNodeType(param.type)) {
      return `        ${param.name} = deserialize_list(input_data["${param.name}"])`;
    } else if (isTreeNodeType(param.type)) {
      return `        ${param.name} = deserialize_tree(input_data["${param.name}"])`;
    } else {
      return `        ${param.name} = input_data["${param.name}"]`;
    }
  }).join('\n');
  
  // Handle output serialization
  let outputSerialization = 'result';
  if (isListNodeType(returnType)) {
    outputSerialization = 'serialize_list(result)';
  } else if (isTreeNodeType(returnType)) {
    outputSerialization = 'serialize_tree(result)';
  }
  
  const args = parameters.map(param => param.name).join(', ');
  
  return `${helpers}
${solutionCode}

import json
import sys

# Test runner
if __name__ == "__main__":
    solution = Solution()
    test_cases = ${JSON.stringify(testCases)}
    
    for i, test_case in enumerate(test_cases):
        input_data = test_case["input"]
        expected = test_case["output"]
        
${argsDeserialization}
        
        result = solution.${functionName}(${args})
        print(f"Test {i}: {json.dumps(${outputSerialization})}")
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
  const { functionName, parameters, returnType } = signature;
  
  // Check if we need helper functions for complex data types
  const needsHelpers = hasComplexDataTypes(signature);
  const helpers = needsHelpers ? getHelpersForLanguage('javascript') : '';
  
  // Build argument deserialization
  const argsDeserialization = parameters.map(param => {
    if (isListNodeType(param.type)) {
      return `    const ${param.name} = deserializeList(input.${param.name});`;
    } else if (isTreeNodeType(param.type)) {
      return `    const ${param.name} = deserializeTree(input.${param.name});`;
    } else {
      return `    const ${param.name} = input.${param.name};`;
    }
  }).join('\n');
  
  // Handle output serialization
  let outputSerialization = 'result';
  if (isListNodeType(returnType)) {
    outputSerialization = 'serializeList(result)';
  } else if (isTreeNodeType(returnType)) {
    outputSerialization = 'serializeTree(result)';
  }
  
  const args = parameters.map(param => param.name).join(', ');
  
  return `${helpers}
${solutionCode}

const solution = new Solution();
const testCases = ${JSON.stringify(testCases)};

for (let i = 0; i < testCases.length; i++) {
    const testCase = testCases[i];
    const input = testCase.input;
    const expected = testCase.output;
    
${argsDeserialization}
    
    const result = solution.${functionName}(${args});
    console.log(\`Test \${i}: \${JSON.stringify(${outputSerialization})}\`);
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
  const { functionName, parameters, returnType } = signature;
  
  // Check if we need helper functions for complex data types
  const needsHelpers = hasComplexDataTypes(signature);
  const helpers = needsHelpers ? getHelpersForLanguage('java') : '';
  
  // Map return type to Java type
  const mapReturnType = (type: string): string => {
    const typeMap: Record<string, string> = {
      'int[]': 'int[]',
      'string[]': 'String[]',
      'double[]': 'double[]',
      'float[]': 'float[]',
      'long[]': 'long[]',
      'boolean[]': 'boolean[]',
      'char[]': 'char[]',
      'int': 'int',
      'string': 'String',
      'boolean': 'boolean',
      'double': 'double',
      'float': 'float',
      'long': 'long',
      'char': 'char',
      'byte': 'byte',
      'short': 'short',
      'ListNode': 'ListNode',
      'TreeNode': 'TreeNode',
    };
    return typeMap[type.toLowerCase()] || type;
  };

  const javaReturnType = mapReturnType(returnType);
  
  // Remove 'public' from Solution class to avoid filename conflicts
  const fixedSolutionCode = solutionCode.replace(/public\s+class\s+Solution/g, 'class Solution');
  
  // Generate hardcoded test cases since Java doesn't have easy JSON parsing in Judge0
  const testCode = testCases.map((testCase, index) => {
    // Build deserialized arguments
    const args = parameters.map(p => {
      const value = testCase.input[p.name];
      const type = p.type.toLowerCase();

      // Handle complex data types
      if (isListNodeType(p.type)) {
        const arrayValue = Array.isArray(value) ? value : [];
        return `ListHelper.deserializeList(java.util.Arrays.asList(${arrayValue.map(v => String(v)).join(', ')}))`;
      } else if (isTreeNodeType(p.type)) {
        const arrayValue = Array.isArray(value) ? value : [];
        return `TreeHelper.deserializeTree(java.util.Arrays.asList(${arrayValue.map(v => v === null ? 'null' : String(v)).join(', ')}))`;
      }
      // Handle primitive arrays
      else if (Array.isArray(value)) {
        if (type === 'int[]') return `new int[]{${value.join(', ')}}`;
        if (type === 'string[]') return `new String[]{${value.map(v => `"${v}"`).join(', ')}}`;
        if (type === 'double[]') return `new double[]{${value.join(', ')}}`;
        if (type === 'float[]') return `new float[]{${value.join('f, ')}f}`; // append 'f' suffix
        if (type === 'long[]') return `new long[]{${value.join('L, ')}L}`;
      }

      if (type === 'string') return `"${value}"`;
      if (type === 'char') return `'${value}'`;
      if (type === 'boolean') return value ? 'true' : 'false';
      return String(value);
    }).join(', ');
    
    // Generate output based on return type
    let outputCode;
    if (isListNodeType(returnType)) {
      outputCode = `System.out.println("Test ${index}: " + ListHelper.serializeList(result${index}));`;
    } else if (isTreeNodeType(returnType)) {
      outputCode = `System.out.println("Test ${index}: " + TreeHelper.serializeTree(result${index}));`;
    } else if (javaReturnType.includes('[]')) {
      outputCode = `System.out.println("Test ${index}: " + java.util.Arrays.toString(result${index}));`;
    } else {
      outputCode = `System.out.println("Test ${index}: " + result${index});`;
    }
    
    return `        // Test ${index + 1}
        ${javaReturnType} result${index} = solution.${functionName}(${args});
        ${outputCode}`;
  }).join('\n');
  
  return `import java.util.*;
${helpers}
${fixedSolutionCode}

public class Main {
    public static void main(String[] args) {
        Solution solution = new Solution();
        
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
  const { functionName, parameters, returnType } = signature;
  
  // Check if we need helper functions for complex data types
  const needsHelpers = hasComplexDataTypes(signature);
  const helpers = needsHelpers ? getHelpersForLanguage('cpp') : '';
  
  // Map return type to C++ type
  const mapReturnType = (type: string): string => {
    const typeMap: Record<string, string> = {
      'int[]': 'vector<int>',
      'string[]': 'vector<string>',
      'int': 'int',
      'string': 'string',
      'boolean': 'bool',
      'double': 'double',
      'float': 'float',
      'long': 'long',
      'ListNode': 'ListNode*',
      'TreeNode': 'TreeNode*',
    };
    return typeMap[type.toLowerCase()] || type;
  };

  const cppReturnType = mapReturnType(returnType);
  
  // Generate hardcoded test cases - create variables first to avoid reference issues
  const testCode = testCases.map((testCase, index) => {
    // Create variables for array parameters to avoid binding rvalue to non-const reference
    const arrayVars = parameters
      .map((p, pIdx) => {
        const value = testCase.input[p.name];
        if (Array.isArray(value)) {
          // Handle complex data types
          if (isListNodeType(p.type)) {
            const arrayValue = value.map(v => v === null ? -1 : v); // Use -1 for null in C++
            return `    vector<int> test${index}_${p.name}_arr = {${arrayValue.join(', ')}};
    ListNode* test${index}_${p.name} = deserializeList(test${index}_${p.name}_arr);`;
          } else if (isTreeNodeType(p.type)) {
            const arrayValue = value.map(v => v === null ? -1 : v); // Use -1 for null in C++
            return `    vector<int> test${index}_${p.name}_arr = {${arrayValue.join(', ')}};
    TreeNode* test${index}_${p.name} = deserializeTree(test${index}_${p.name}_arr);`;
          } else {
            return `    vector<int> test${index}_${p.name} = {${value.join(', ')}};`;
          }
        }
        return null;
      })
      .filter(Boolean)
      .join('\n');
    
    const args = parameters.map(p => {
      const value = testCase.input[p.name];
      if (Array.isArray(value)) {
        if (isListNodeType(p.type) || isTreeNodeType(p.type)) {
          return `test${index}_${p.name}`;
        } else {
          return `test${index}_${p.name}`;
        }
      }
      return String(value);
    }).join(', ');
    
    // Generate output based on return type
    let outputCode;
    if (isListNodeType(returnType)) {
      outputCode = `    vector<int> result${index}_serialized = serializeList(result${index});
    cout << "Test ${index}: [";
    for (int i = 0; i < result${index}_serialized.size(); i++) {
        cout << result${index}_serialized[i];
        if (i < result${index}_serialized.size() - 1) cout << ",";
    }
    cout << "]" << endl;`;
    } else if (isTreeNodeType(returnType)) {
      outputCode = `    vector<int> result${index}_serialized = serializeTree(result${index});
    cout << "Test ${index}: [";
    for (int i = 0; i < result${index}_serialized.size(); i++) {
        cout << result${index}_serialized[i];
        if (i < result${index}_serialized.size() - 1) cout << ",";
    }
    cout << "]" << endl;`;
    } else if (cppReturnType.includes('vector')) {
      outputCode = `    cout << "Test ${index}: [";
    for (int i = 0; i < result${index}.size(); i++) {
        cout << result${index}[i];
        if (i < result${index}.size() - 1) cout << ",";
    }
    cout << "]" << endl;`;
    } else {
      outputCode = `    cout << "Test ${index}: " << result${index} << endl;`;
    }
    
    return `    // Test ${index + 1}
${arrayVars}
    ${cppReturnType} result${index} = solution.${functionName}(${args});
${outputCode}`;
  }).join('\n');
  
  return `#include <iostream>
#include <vector>
#include <string>
#include <queue>
using namespace std;

${helpers}
${solutionCode}

int main() {
    Solution solution;
    
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

